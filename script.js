// script.js — improved progressive rendering for crisp pages on mobile & desktop
// Replaces previous renderPageToDataURL with a progressive low->high render that uses devicePixelRatio.
(function(){
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js';
  } else {
    alert('pdf.js not loaded. Check CDN connection.');
  }

  // Elements
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const pageEl = document.getElementById('page');
  const flipLayer = document.getElementById('flipLayer');
  const flipFront = document.getElementById('flipFront');
  const flipBack = document.getElementById('flipBack');
  const stage = document.getElementById('stage');
  const mobileNav = document.getElementById('mobileNav');
  const mPrev = document.getElementById('mPrev');
  const mNext = document.getElementById('mNext');

  let pdfDoc = null;
  let actualTotal = 0;
  let pageMap = [];
  let currentIndex = 0;
  let animating = false;

  // Cache structure:
  // cache[pageNum] = { low: dataURL, high: dataURL, highRendering: Promise|null, renderedAtWidth: width }
  const cache = {};

  // Configuration — tune as needed
  const BASE_SCALE = 1.2;           // baseline render scale factor (multiplies with container width ratio)
  const THUMB_SCALE = 0.7;          // thumbnail scale
  const LOW_PREVIEW_SCALE = 0.6;    // quick low-res preview scale multiplier
  const MAX_CANVAS_PIXELS = 2_000_000; // cap: max canvas pixels (width*height) to avoid memory blowup

  // ---- Utilities ----
  function setPlaceholder(msg){
    pageEl.innerHTML = `<div class="placeholder">${msg}</div>`;
    console.info('Flipbook:', msg);
  }

  // Compute rendering scale dynamically:
  function computeScalesForPage(page, desiredScaleMultiplier = BASE_SCALE) {
    // container physical width
    const containerWidth = Math.min(document.querySelector('.page').clientWidth || 800, 1200);
    // device pixel ratio to produce crisp images on high-DPI displays
    const DPR = Math.max(1, window.devicePixelRatio || 1);

    // width-based scale roughly: baseScale * (containerWidth / 800)
    const baseScale = desiredScaleMultiplier * (containerWidth / 800);

    // low preview scale is smaller and without DPR
    const lowScale = Math.max(0.4, LOW_PREVIEW_SCALE * (containerWidth / 800));

    // high scale includes DPR for crispness
    let highScale = baseScale * DPR;

    // ensure we do not blow up the canvas: compute estimated viewport pixels for a typical PDF page ratio
    // We'll request page.getViewport with scale to get exact numbers later, but we can cap roughly:
    // Approx width in px = pageWidthAtScale. We'll cap by computing viewport width * height later per page.

    return { lowScale, highScale, DPR, containerWidth };
  }

  // Progressive render: first low-res then high-res replacement.
  // Returns a promise that resolves with the low-res dataURL (immediate) and schedules high-res rendering which updates cache.
  async function progressiveRenderPage(pageNum) {
    // If already have high-res cached, return it immediately
    if (cache[pageNum] && cache[pageNum].high) {
      return { low: cache[pageNum].low || cache[pageNum].high, highImmediate: true };
    }

    // If a high rendering is already in progress, return low if available and let the high promise continue
    if (cache[pageNum] && cache[pageNum].highRendering) {
      return { low: cache[pageNum].low || null, highImmediate: false };
    }

    // Otherwise start rendering low + high
    cache[pageNum] = cache[pageNum] || { low: null, high: null, highRendering: null, renderedAtWidth: 0 };

    // Render low preview quickly (smaller scale)
    const lowPromise = (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const { lowScale } = computeScalesForPage(page, BASE_SCALE);
        const viewportLow = page.getViewport({ scale: lowScale });
        // cap canvas size for low preview
        const canvasLow = document.createElement('canvas');
        canvasLow.width = Math.floor(viewportLow.width);
        canvasLow.height = Math.floor(viewportLow.height);
        const ctxLow = canvasLow.getContext('2d');
        ctxLow.fillStyle = '#ffffff';
        ctxLow.fillRect(0,0,canvasLow.width,canvasLow.height);
        await page.render({ canvasContext: ctxLow, viewport: viewportLow }).promise;
        const dataLow = canvasLow.toDataURL('image/jpeg', 0.75);
        cache[pageNum].low = dataLow;
        return dataLow;
      } catch (err) {
        console.error('Low-res render failed for', pageNum, err);
        return null;
      }
    })();

    // Start high-res render in background and store the promise
    const highPromise = (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const { highScale, containerWidth } = computeScalesForPage(page, BASE_SCALE);

        const viewportHigh = page.getViewport({ scale: highScale });

        // Cap based on MAX_CANVAS_PIXELS to avoid memory blowups
        // If width*height exceeds cap, reduce scale proportionally
        const estimatedPixels = viewportHigh.width * viewportHigh.height;
        let finalViewport = viewportHigh;
        if (estimatedPixels > MAX_CANVAS_PIXELS) {
          const reductionFactor = Math.sqrt(MAX_CANVAS_PIXELS / estimatedPixels);
          finalViewport = page.getViewport({ scale: highScale * reductionFactor });
          console.info(`High render for page ${pageNum} capped to avoid large canvas (factor ${reductionFactor.toFixed(2)})`);
        }

        const canvasHigh = document.createElement('canvas');
        canvasHigh.width = Math.floor(finalViewport.width);
        canvasHigh.height = Math.floor(finalViewport.height);
        const ctxHigh = canvasHigh.getContext('2d');
        ctxHigh.fillStyle = '#ffffff';
        ctxHigh.fillRect(0,0,canvasHigh.width,canvasHigh.height);
        await page.render({ canvasContext: ctxHigh, viewport: finalViewport }).promise;
        const dataHigh = canvasHigh.toDataURL('image/jpeg', 0.92);
        cache[pageNum].high = dataHigh;
        cache[pageNum].highRendering = null;
        cache[pageNum].renderedAtWidth = containerWidth;
        return dataHigh;
      } catch (err) {
        console.error('High-res render failed for', pageNum, err);
        cache[pageNum].highRendering = null;
        return null;
      }
    })();

    cache[pageNum].highRendering = highPromise;

    // return the low preview immediately (when resolved)
    const lowData = await lowPromise;
    return { low: lowData, highImmediate: false };
  }

  // Helper to ensure high-res replacement is applied when ready for the currently visible page
  async function ensureHighResReplacementIfNeeded(pageNum, currentDisplayedPageNum) {
    // If high already available and different from low, apply it
    if (!cache[pageNum]) return;
    if (cache[pageNum].high && cache[pageNum].high !== cache[pageNum].low) {
      // If the page on screen is still the same pageNum, update DOM
      if (currentDisplayedPageNum === pageNum) {
        setMainPageImage(cache[pageNum].high);
      }
      return;
    }
    // else wait for high rendering if it's in progress, then apply (only if still showing)
    if (cache[pageNum].highRendering) {
      try {
        const dataHigh = await cache[pageNum].highRendering;
        if (dataHigh && currentDisplayedPageNum === pageNum) {
          setMainPageImage(dataHigh);
        }
      } catch (err) {
        // ignore
      }
    }
  }

  // Create thumbnail (low-res)
  async function renderThumbnail(pageNum) {
    try {
      if (cache[pageNum] && cache[pageNum].thumb) return cache[pageNum].thumb;
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: THUMB_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const data = canvas.toDataURL('image/jpeg', 0.7);
      cache[pageNum] = cache[pageNum] || {};
      cache[pageNum].thumb = data;
      return data;
    } catch (err) {
      console.error('Thumbnail render failed', pageNum, err);
      return null;
    }
  }

  // DOM helpers
  function setMainPageImage(dataUrl){
    pageEl.innerHTML = '';
    if (!dataUrl) {
      const d = document.createElement('div'); d.className='placeholder'; d.textContent='Blank';
      pageEl.appendChild(d); return;
    }
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.imageRendering = 'auto';
    pageEl.appendChild(img);
  }

  // Show an index instantly (progressive rendering)
  async function showIndexInstant(idx){
    if (!pdfDoc) return;
    idx = Math.max(0, Math.min(idx, pageMap.length - 1));
    currentIndex = idx;
    const actual = pageMap[idx];
    setPlaceholder('Rendering preview…');

    // Start progressive render (low immediate, high in background)
    const { low } = await progressiveRenderPage(actual);
    if (!low) {
      setPlaceholder('Could not render preview.');
      return;
    }
    // show low immediately
    setMainPageImage(low);

    // Now ensure high replacement when ready
    ensureHighResReplacementIfNeeded(actual, actual).catch(()=>{ /* ignore */ });
  }

  // Flip animation functions remain same but call progressive rendering for the back pages too
  async function flipToIndex(targetIdx){
    if (!pdfDoc || animating) return;
    targetIdx = Math.max(0, Math.min(targetIdx, pageMap.length - 1));
    if (targetIdx === currentIndex) return;
    animating = true;

    const forward = targetIdx > currentIndex;
    const curActual = pageMap[currentIndex];
    const nextActual = pageMap[targetIdx];

    // Ensure we have low previews for both faces (start both renders)
    const curLowPromise = progressiveRenderPage(curActual).then(res => res.low).catch(()=>null);
    const nextLowPromise = progressiveRenderPage(nextActual).then(res => res.low).catch(()=>null);

    const frontUrl = await curLowPromise;
    const backUrl  = await nextLowPromise;

    flipFront.style.background = frontUrl ? `url('${frontUrl}') center/cover no-repeat` : '#fff';
    flipBack.style.background  = backUrl  ? `url('${backUrl}') center/cover no-repeat` : '#fff';

    flipLayer.classList.add('show','flip-animate');
    flipLayer.style.transformOrigin = forward ? 'left center' : 'right center';
    flipLayer.style.transform = forward ? 'rotateY(0deg)' : 'rotateY(180deg)';

    const duration = (window.innerWidth < 900) ? 420 : 700;
    flipLayer.style.transitionDuration = duration + 'ms';

    requestAnimationFrame(()=> {
      flipLayer.style.transform = forward ? 'rotateY(-180deg)' : 'rotateY(0deg)';
    });

    await new Promise(res => {
      const onEnd = (e) => {
        flipLayer.removeEventListener('transitionend', onEnd);
        res();
      };
      flipLayer.addEventListener('transitionend', onEnd);
    });

    flipLayer.classList.remove('show','flip-animate');
    flipLayer.style.transform = '';

    currentIndex = targetIdx;
    // Show the low preview for the new page immediately and then replace with high res when ready
    await showIndexInstant(currentIndex);

    // trigger high-res replacement when it's done
    const actualNow = pageMap[currentIndex];
    if (cache[actualNow] && cache[actualNow].highRendering) {
      cache[actualNow].highRendering.then((highData) => {
        if (highData && pageMap[currentIndex] === actualNow) {
          setMainPageImage(highData);
        }
      }).catch(()=>{/*ignore*/});
    }

    animating = false;
  }

  // Navigation helpers
  function nextPage(){ flipToIndex(currentIndex + 1); }
  function prevPage(){ flipToIndex(currentIndex - 1); }

  // UI attach
  btnNext.addEventListener('click', nextPage);
  btnPrev.addEventListener('click', prevPage);
  if (mPrev && mNext) {
    mPrev.addEventListener('click', prevPage);
    mNext.addEventListener('click', nextPage);
    const small = window.matchMedia('(max-width:520px)').matches;
    mobileNav.setAttribute('aria-hidden', small ? 'false' : 'true');
  }

  // Wheel navigation (debounced)
  (function addWheel(){
    let last = 0;
    window.addEventListener('wheel', (e) => {
      const now = Date.now();
      if (now - last < 300) return;
      if (Math.abs(e.deltaY) < 20) return;
      last = now;
      if (e.deltaY > 0) nextPage();
      else prevPage();
    }, {passive:true});
  })();

  // Touch swipe
  (function addTouch(){
    let startX=0,startY=0,moved=false;
    stage.addEventListener('touchstart', (ev)=> {
      if (ev.touches.length>1) return;
      startX = ev.touches[0].clientX;
      startY = ev.touches[0].clientY;
      moved = false;
    }, {passive:true});
    stage.addEventListener('touchmove', (ev)=> {
      if (ev.touches.length>1) return;
      const dx = ev.touches[0].clientX - startX;
      const dy = ev.touches[0].clientY - startY;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) moved = true;
    }, {passive:true});
    stage.addEventListener('touchend', (ev)=> {
      if (!moved) return;
      const endX = (ev.changedTouches && ev.changedTouches[0]) ? ev.changedTouches[0].clientX : startX;
      const dx = endX - startX;
      if (dx < -40) nextPage();
      else if (dx > 40) prevPage();
    }, {passive:true});
  })();

  // Keyboard nav
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') nextPage();
    if (e.key === 'ArrowLeft') prevPage();
  });

  // Load PDF and setup pageMap (skip page 2 rule kept)
  async function loadPdfUrl(url){
    try {
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) {
        setPlaceholder(`PDF not found (HTTP ${resp.status}). Put myfile.pdf next to files.`);
        console.error('Fetch status', resp.status);
        return;
      }
      const buf = await resp.arrayBuffer();
      await loadPdfData(buf);
    } catch (err) {
      console.error('Fetch/load error', err);
      setPlaceholder('Could not fetch myfile.pdf — see console.');
    }
  }

  async function loadPdfData(buf){
    try {
      pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
      await setupPageMap();
    } catch (err) {
      console.error('PDF load error', err);
      setPlaceholder('Could not load PDF — it may be corrupt or unsupported.');
    }
  }

  async function setupPageMap(){
    if (!pdfDoc) { setPlaceholder('PDF not available'); return; }
    actualTotal = pdfDoc.numPages;
    pageMap = [];
    for (let p=1; p<=actualTotal; p++){
      if (p === 2) continue;
      pageMap.push(p);
    }
    if (pageMap.length === 0 && actualTotal >= 1) {
      pageMap = [];
      for (let p=1; p<=actualTotal; p++) pageMap.push(p);
    }
    currentIndex = 0;
    // clear cache because page sizes may differ
    for (const k in cache) delete cache[k];
    await showIndexInstant(0);
  }

  // Auto-load myfile.pdf
  document.addEventListener('DOMContentLoaded', function () {
    const defaultPdfPath = 'myfile.pdf';
    loadPdfUrl(defaultPdfPath);
  });

  // On resize, clear high-res cache if container grew/shrank significantly to force re-render at new resolution
  let resizeTO = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => {
      if (!pdfDoc) return;
      // Clear high-res caches so we re-render crisp images at new sizes
      for (const p in cache) {
        if (cache[p]) {
          cache[p].high = null;
          cache[p].highRendering = null;
        }
      }
      // re-show current index (will trigger progressive render again)
      showIndexInstant(currentIndex).catch(()=>{});
    }, 300);
  });

  // Expose for debug
  window.flipbook = {
    nextPage, prevPage, showIndexInstant
  };

})();
