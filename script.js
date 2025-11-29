// Fixed single-page flipbook script — robust loader and mobile overlay nav
(function(){
  // Ensure pdfjs is defined
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
  let cache = {};
  let animating = false;

  // helper: set placeholder text (also logs)
  function setPlaceholder(msg){
    pageEl.innerHTML = `<div class="placeholder">${msg}</div>`;
    console.info('Flipbook:', msg);
  }

  // render page to dataURL (cached)
  async function renderPageToDataURL(pageNum, scale = 1.5){
    if (cache[pageNum]) return cache[pageNum];
    try {
      const page = await pdfDoc.getPage(pageNum);
      // dynamic scale based on container
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
    } catch (err) {
      console.error('Render error for page', pageNum, err);
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
    pageEl.appendChild(img);
  }

  async function showIndexInstant(idx){
    if (!pdfDoc) return;
    idx = Math.max(0, Math.min(idx, pageMap.length - 1));
    currentIndex = idx;
    const actual = pageMap[idx];
    setPlaceholder('Rendering page…');
    const data = (actual <= actualTotal) ? await renderPageToDataURL(actual) : null;
    if (!data) {
      setPlaceholder('Could not render page.');
    } else {
      setMainPageImage(data);
    }
  }

  async function flipToIndex(targetIdx){
    if (!pdfDoc || animating) return;
    targetIdx = Math.max(0, Math.min(targetIdx, pageMap.length - 1));
    if (targetIdx === currentIndex) return;
    animating = true;

    const forward = targetIdx > currentIndex;
    const curActual = pageMap[currentIndex];
    const nextActual = pageMap[targetIdx];

    const frontUrl = (curActual <= actualTotal) ? await renderPageToDataURL(curActual) : null;
    const backUrl  = (nextActual <= actualTotal) ? await renderPageToDataURL(nextActual) : null;

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
    await showIndexInstant(currentIndex);
    animating = false;
  }

  function nextPage(){ flipToIndex(currentIndex + 1); }
  function prevPage(){ flipToIndex(currentIndex - 1); }

  // attach UI
  btnNext.addEventListener('click', nextPage);
  btnPrev.addEventListener('click', prevPage);
  if (mPrev && mNext) {
    mPrev.addEventListener('click', prevPage);
    mNext.addEventListener('click', nextPage);
    // ensure mobile overlay visible attribute toggled
    const small = window.matchMedia('(max-width:520px)').matches;
    mobileNav.setAttribute('aria-hidden', small ? 'false' : 'true');
  }

  // wheel debounce
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

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') nextPage();
    if (e.key === 'ArrowLeft') prevPage();
  });

  // Loaders (GET approach) — more reliable than HEAD on some hosts
  async function loadPdfUrl(url){
    try {
      // try fetching the file first to detect 404/CORS and give better message
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
      setPlaceholder('Could not fetch myfile.pdf — see console for details.');
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

  // Build pageMap skipping page 2
  async function setupPageMap(){
    if (!pdfDoc) { setPlaceholder('PDF not available'); return; }
    actualTotal = pdfDoc.numPages;
    pageMap = [];
    for (let p=1; p<=actualTotal; p++){
      if (p === 2) continue; // skip page 2
      pageMap.push(p);
    }
    if (pageMap.length === 0 && actualTotal >= 1) {
      // fallback: don't skip if skipping removed all pages
      pageMap = [];
      for (let p=1; p<=actualTotal; p++) pageMap.push(p);
    }
    currentIndex = 0;
    cache = {};
    await showIndexInstant(0);
  }

  // Auto-load myfile.pdf when DOM ready (no HEAD check)
  document.addEventListener('DOMContentLoaded', function () {
    const defaultPdfPath = 'myfile.pdf';
    // Try fetch GET — will show clearer error if missing/CORS
    loadPdfUrl(defaultPdfPath);
  });

  // Re-render on resize for crispness (debounced)
  let rto = null;
  window.addEventListener('resize', ()=>{
    clearTimeout(rto);
    rto = setTimeout(async ()=>{
      if (!pdfDoc) return;
      cache = {};
      await showIndexInstant(currentIndex);
    }, 300);
  });

  // expose helpers
  window.flipbook = { nextPage, prevPage, showIndexInstant };

})();
