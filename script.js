// script.js — progressive rendering + curl preview + depth shadow
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
  const pageWrap = document.getElementById('pageWrap');
  const curlEl = document.getElementById('curl');

  let pdfDoc = null;
  let actualTotal = 0;
  let pageMap = [];
  let currentIndex = 0;
  let animating = false;

  // Cache structure (same as earlier progressive version)
  const cache = {};
  const BASE_SCALE = 1.2;
  const THUMB_SCALE = 0.7;
  const LOW_PREVIEW_SCALE = 0.6;
  const MAX_CANVAS_PIXELS = 2_000_000;

  // Basic placeholder
  function setPlaceholder(msg){
    pageEl.innerHTML = `<div class="placeholder">${msg}</div>`;
    console.info('Flipbook:', msg);
  }

  // compute scales
  function computeScalesForPage(page, desiredScaleMultiplier = BASE_SCALE) {
    const containerWidth = Math.min(document.querySelector('.page').clientWidth || 800, 1200);
    const DPR = Math.max(1, window.devicePixelRatio || 1);
    const baseScale = desiredScaleMultiplier * (containerWidth / 800);
    const lowScale = Math.max(0.4, LOW_PREVIEW_SCALE * (containerWidth / 800));
    let highScale = baseScale * DPR;
    return { lowScale, highScale, DPR, containerWidth };
  }

  // progressive render low then high (same as earlier)
  async function progressiveRenderPage(pageNum) {
    if (cache[pageNum] && cache[pageNum].high) {
      return { low: cache[pageNum].low || cache[pageNum].high, highImmediate: true };
    }
    if (cache[pageNum] && cache[pageNum].highRendering) {
      return { low: cache[pageNum].low || null, highImmediate: false };
    }
    cache[pageNum] = cache[pageNum] || { low: null, high: null, highRendering: null, renderedAtWidth: 0 };

    const lowPromise = (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const { lowScale } = computeScalesForPage(page, BASE_SCALE);
        const viewportLow = page.getViewport({ scale: lowScale });
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

    const highPromise = (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const { highScale, containerWidth } = computeScalesForPage(page, BASE_SCALE);
        const viewportHigh = page.getViewport({ scale: highScale });
        const estimatedPixels = viewportHigh.width * viewportHigh.height;
        let finalViewport = viewportHigh;
        if (estimatedPixels > MAX_CANVAS_PIXELS) {
          const reductionFactor = Math.sqrt(MAX_CANVAS_PIXELS / estimatedPixels);
          finalViewport = page.getViewport({ scale: highScale * reductionFactor });
          console.info(`High render for page ${pageNum} capped (factor ${reductionFactor.toFixed(2)})`);
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
    const lowData = await lowPromise;
    return { low: lowData, highImmediate: false };
  }

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

  async function showIndexInstant(idx){
    if (!pdfDoc) return;
    idx = Math.max(0, Math.min(idx, pageMap.length - 1));
    currentIndex = idx;
    const actual = pageMap[idx];
    setPlaceholder('Rendering preview…');
    const { low } = await progressiveRenderPage(actual);
    if (!low) {
      setPlaceholder('Could not render preview.');
      return;
    }
    setMainPageImage(low);
    // replace with high when ready
    if (cache[actual] && cache[actual].highRendering) {
      cache[actual].highRendering.then(high => {
        if (high && pageMap[currentIndex] === actual) setMainPageImage(high);
      }).catch(()=>{});
    } else if (cache[actual] && cache[actual].high) {
      setMainPageImage(cache[actual].high);
    }
  }

  // Flip animation (uses low previews for faces, high-res replacement after)
  async function flipToIndex(targetIdx){
    if (!pdfDoc || animating) return;
    targetIdx = Math.max(0, Math.min(targetIdx, pageMap.length - 1));
    if (targetIdx === currentIndex) return;
    animating = true;

    const forward = targetIdx > currentIndex;
    const curActual = pageMap[currentIndex];
    const nextActual = pageMap[targetIdx];

    // trigger depth shadow
    pageWrap.classList.add('depth');

    // ensure low previews for both faces
    const curLowPromise = progressiveRenderPage(curActual).then(r=>r.low).catch(()=>null);
    const nextLowPromise = progressiveRenderPage(nextActual).then(r=>r.low).catch(()=>null);

    const frontUrl = await curLowPromise;
    const backUrl  = await nextLowPromise;

    flipFront.style.background = frontUrl ? `url('${frontUrl}') center/cover no-repeat` : '#fff';
    flipBack.style.background  = backUrl  ? `url('${backUrl}') center/cover no-repeat` : '#fff';

    flipLayer.classList.add('show','flip-animate');
    flipLayer.style.transformOrigin = forward ? 'left center' : 'right center';
    flipLayer.style.transform = forward ? 'rotateY(0deg)' : 'rotateY(180deg)';

    const duration = (window.innerWidth < 900) ? 420 : 700;
    flipLayer.style.transitionDuration = duration + 'ms';

    requestAnimationFrame(()=> { flipLayer.style.transform = forward ? 'rotateY(-180deg)' : 'rotateY(0deg)'; });

    await new Promise(res => {
      const onEnd = (e) => { flipLayer.removeEventListener('transitionend', onEnd); res(); };
      flipLayer.addEventListener('transitionend', onEnd);
    });

    flipLayer.classList.remove('show','flip-animate');
    flipLayer.style.transform = '';

    currentIndex = targetIdx;
    await showIndexInstant(currentIndex);

    // remove depth after a small delay for smoothness
    setTimeout(()=> pageWrap.classList.remove('depth'), 240);

    animating = false;
  }

  function nextPage(){ flipToIndex(currentIndex + 1); }
  function prevPage(){ flipToIndex(currentIndex - 1); }

  // Attach UI
  btnNext.addEventListener('click', nextPage);
  btnPrev.addEventListener('click', prevPage);
  if (mPrev && mNext) {
    mPrev.addEventListener('click', prevPage);
    mNext.addEventListener('click', nextPage);
    const small = window.matchMedia('(max-width:520px)').matches;
    mobileNav.setAttribute('aria-hidden', small ? 'false' : 'true');
  }

  // wheel
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

  // touch swipe
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

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') nextPage();
    if (e.key === 'ArrowLeft') prevPage();
  });

  // Load PDF and pageMap (skip page 2)
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
    // clear cache
    for (const k in cache) delete cache[k];
    await showIndexInstant(0);
  }

  // Curl preview behavior:
  // - On desktop (not small screen) hovering pageWrap shows curl.
  // - When curl is shown, we request a low preview of the *next* page and set it as curl background.
  // - Clicking the curl acts like Next page.
  function isSmallScreen() {
    return window.matchMedia('(max-width:520px)').matches;
  }

  // show curl preview for the next logical page
  async function prepareCurlPreview() {
    if (isSmallScreen()) return;
    const nextIdx = Math.min(currentIndex + 1, pageMap.length - 1);
    if (nextIdx < 0 || nextIdx === currentIndex) {
      curlEl.style.opacity = '0';
      return;
    }
    const nextActual = pageMap[nextIdx];
    try {
      const { low } = await progressiveRenderPage(nextActual);
      if (low) {
        curlEl.style.backgroundImage = `url('${low}')`;
        curlEl.style.backgroundSize = 'cover';
        curlEl.style.opacity = '1';
        curlEl.setAttribute('aria-hidden','false');
      } else {
        curlEl.style.opacity = '0';
      }
    } catch (err) {
      console.error('Curl preview failed', err);
      curlEl.style.opacity = '0';
    }
  }

  // event handlers for curl & hover
  let hoverTimeout = null;
  pageWrap.addEventListener('mouseenter', (e) => {
    if (isSmallScreen()) return;
    // small delay to avoid accidental flicker
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      pageWrap.classList.add('depth'); // subtle pop on hover
      prepareCurlPreview();
    }, 120);
  });
  pageWrap.addEventListener('mouseleave', (e) => {
    if (isSmallScreen()) return;
    clearTimeout(hoverTimeout);
    pageWrap.classList.remove('depth');
    curlEl.style.opacity = '0';
  });

  // clicking curl goes next
  curlEl.addEventListener('click', (e) => {
    e.stopPropagation();
    nextPage();
  });

  // wheel / touch / keyboard already attached earlier

  // Auto-load myfile.pdf
  document.addEventListener('DOMContentLoaded', function () {
    loadPdfUrl('myfile.pdf');
  });

  // resize: clear high-res caches to re-render crisp images
  let resizeTO = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTO);
    resizeTO = setTimeout(() => {
      if (!pdfDoc) return;
      for (const p in cache) { if (cache[p]) { cache[p].high = null; cache[p].highRendering = null; } }
      showIndexInstant(currentIndex).catch(()=>{});
    }, 300);
  });

  // expose for debug
  window.flipbook = { nextPage, prevPage, showIndexInstant };

})();
