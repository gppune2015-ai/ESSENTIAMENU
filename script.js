// Single-page 3D flipbook with: auto-load myfile.pdf, skip PDF page #2, single-page view, wheel & swipe navigation
(function(){
  // pdf.js worker
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

  let pdfDoc = null;
  let actualTotal = 0;       // actual PDF page count
  let pageMap = [];         // maps logical index -> actual PDF page number (skips page 2)
  let currentIndex = 0;     // index into pageMap (0-based)
  let cache = {};           // cache images by actual PDF page number
  let animating = false;

  // --- render one PDF page to a data URL (cache)
  async function renderPageToDataURL(pageNum, scale = 1.5){
    if (cache[pageNum]) return cache[pageNum];
    const page = await pdfDoc.getPage(pageNum);
    // scale depends on page container; choose dynamic scale for sharpness
    // approximate width in px:
    const containerWidth = Math.min(document.querySelector('.page').clientWidth, 1000);
    const viewport = page.getViewport({ scale: scale * (containerWidth / 800) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const data = canvas.toDataURL('image/jpeg', 0.92);
    cache[pageNum] = data;
    return data;
  }

  // set main page image
  function setMainPageImage(dataUrl){
    pageEl.innerHTML = '';
    if (!dataUrl) {
      const d = document.createElement('div'); d.className='placeholder'; d.textContent='Blank';
      pageEl.appendChild(d); return;
    }
    const img = document.createElement('img');
    img.src = dataUrl;
    pageEl.appendChild(img);
  }

  // update current displayed page instantly (no animation)
  async function showIndexInstant(idx){
    if (!pdfDoc) return;
    idx = Math.max(0, Math.min(idx, pageMap.length - 1));
    currentIndex = idx;
    const actual = pageMap[idx];
    const data = (actual <= actualTotal) ? await renderPageToDataURL(actual) : null;
    setMainPageImage(data);
  }

  // flip animation: show current -> target index
  async function flipToIndex(targetIdx){
    if (!pdfDoc || animating) return;
    targetIdx = Math.max(0, Math.min(targetIdx, pageMap.length - 1));
    if (targetIdx === currentIndex) return;
    animating = true;

    const forward = targetIdx > currentIndex;
    const curActual = pageMap[currentIndex];
    const nextActual = pageMap[targetIdx];

    // prepare front/back images: front = current page, back = next page
    const frontUrl = (curActual <= actualTotal) ? await renderPageToDataURL(curActual) : null;
    const backUrl  = (nextActual <= actualTotal) ? await renderPageToDataURL(nextActual) : null;

    flipFront.style.background = frontUrl ? `url('${frontUrl}') center/cover no-repeat` : '#fff';
    flipBack.style.background  = backUrl  ? `url('${backUrl}') center/cover no-repeat` : '#fff';

    // show flip-layer and choose transform origin
    flipLayer.classList.add('show','flip-animate');
    flipLayer.style.transformOrigin = forward ? 'left center' : 'right center';
    flipLayer.style.transform = forward ? 'rotateY(0deg)' : 'rotateY(180deg)';

    // adjust duration for smaller screens
    const duration = (window.innerWidth < 900) ? 420 : 700;
    flipLayer.style.transitionDuration = duration + 'ms';

    // trigger
    requestAnimationFrame(()=> {
      flipLayer.style.transform = forward ? 'rotateY(-180deg)' : 'rotateY(0deg)';
    });

    // wait for end
    await new Promise(res => {
      const onEnd = (e) => {
        flipLayer.removeEventListener('transitionend', onEnd);
        res();
      };
      flipLayer.addEventListener('transitionend', onEnd);
    });

    // hide flip layer, update main page
    flipLayer.classList.remove('show','flip-animate');
    flipLayer.style.transform = '';
    currentIndex = targetIdx;
    await showIndexInstant(currentIndex);
    animating = false;
  }

  // next / prev actions (skip page #2 already enforced via pageMap)
  function nextPage(){ flipToIndex(currentIndex + 1); }
  function prevPage(){ flipToIndex(currentIndex - 1); }

  // attach buttons
  btnNext.addEventListener('click', nextPage);
  btnPrev.addEventListener('click', prevPage);

  // wheel to change one page per scroll (with small debounce)
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

  // touch swipe (mobile)
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

  // keyboard nav
  window.addEventListener('keydown', (e)=>{
    if (e.key === 'ArrowRight') nextPage();
    if (e.key === 'ArrowLeft') prevPage();
  });

  // load PDF by URL or ArrayBuffer
  async function loadPdfUrl(url){
    try {
      pdfDoc = await pdfjsLib.getDocument({ url }).promise;
      await setupPageMap();
    } catch(err){
      console.error('Load failed', err);
      // try nothing more; show message
      pageEl.innerHTML = '<div class="placeholder">Could not load PDF.</div>';
    }
  }
  async function loadPdfData(buf){
    try {
      pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
      await setupPageMap();
    } catch(err){
      console.error('Load failed', err);
      pageEl.innerHTML = '<div class="placeholder">Could not load PDF.</div>';
    }
  }

  // Build pageMap skipping actual page #2
  async function setupPageMap(){
    if (!pdfDoc) return;
    actualTotal = pdfDoc.numPages;
    pageMap = [];
    for (let p=1;p<=actualTotal;p++){
      if (p === 2) continue; // skip only page 2
      pageMap.push(p);
    }
    // if the PDF has only page 2 or becomes empty after skipping, fallback to include page 2
    if (pageMap.length === 0 && actualTotal >= 1){
      // if total was 1 or only page 2 existed, don't skip
      pageMap = [];
      for (let p=1;p<=actualTotal;p++) pageMap.push(p);
    }
    currentIndex = 0;
    cache = {};
    await showIndexInstant(0);
  }

  // Auto-load myfile.pdf (in same folder) — use HEAD check to avoid console noise
  document.addEventListener('DOMContentLoaded', function () {
    const defaultPdfPath = 'myfile.pdf';
    fetch(defaultPdfPath, { method: 'HEAD' })
      .then(resp => {
        if (resp.ok) {
          loadPdfUrl(defaultPdfPath);
        } else {
          pageEl.innerHTML = '<div class="placeholder">Place <strong>myfile.pdf</strong> in the same folder. Viewer will auto-load it.</div>';
        }
      })
      .catch(err => {
        console.info('Could not check myfile.pdf:', err);
        pageEl.innerHTML = '<div class="placeholder">Place <strong>myfile.pdf</strong> in the same folder. Viewer will auto-load it.</div>';
      });
  });

  // optional: re-render current page on resize for sharpness (debounced)
  let rto = null;
  window.addEventListener('resize', ()=>{
    clearTimeout(rto);
    rto = setTimeout(async ()=>{
      if (!pdfDoc) return;
      // clear cache to re-render at new sizes for crispness (comment out to save CPU)
      cache = {};
      await showIndexInstant(currentIndex);
    }, 300);
  });

  // expose next/prev (debug)
  window.flipbook = { nextPage, prevPage, showIndexInstant };

})();
