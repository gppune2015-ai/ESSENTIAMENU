// 3D PDF Flipbook script (with auto-load for myfile.pdf)
(function(){
  // pdf.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js';
  } else {
    alert('pdf.js not loaded. Check CDN connection.');
  }

  // Elements
  const fileInput = document.getElementById('fileInput');
  const pdfUrlIn = document.getElementById('pdfUrl');
  const loadBtn = document.getElementById('loadBtn');
  const btnNext = document.getElementById('btnNext');
  const btnPrev = document.getElementById('btnPrev');
  const pageDisplay = document.getElementById('pageDisplay');
  const totalPagesEl = document.getElementById('totalPages');
  const busyEl = document.getElementById('busy');

  const leftPage = document.getElementById('leftPage');
  const rightPage = document.getElementById('rightPage');
  const flipLayer = document.getElementById('flipLayer');
  const flipFront = document.getElementById('flipFront');
  const flipBack = document.getElementById('flipBack');
  const thumbs = document.getElementById('thumbs');
  const stage = document.getElementById('stage');

  let pdfDoc = null;
  let totalPages = 0;
  let currentLeft = 1; // left page number
  let cache = {};

  function setBusy(on){
    busyEl.innerHTML = on ? '<span class="loader"></span>' : '';
  }

  async function renderPageToDataURL(pageNum, scale = 1.5){
    if (cache[pageNum]) return cache[pageNum];
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
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

  function setPageImage(el, dataUrl){
    el.innerHTML = '';
    if (!dataUrl) {
      const d = document.createElement('div');
      d.className = 'placeholder';
      d.textContent = 'Blank';
      el.appendChild(d);
      return;
    }
    const img = document.createElement('img');
    img.src = dataUrl;
    el.appendChild(img);
  }

  async function updateSpreadInstant(left){
    if (!pdfDoc) return;
    left = Math.max(1, Math.min(left, totalPages));
    currentLeft = left;
    const right = left + 1;
    pageDisplay.textContent = right <= totalPages ? `Pages ${left} - ${right}` : `Page ${left}`;
    totalPagesEl.textContent = `of ${totalPages}`;

    setBusy(true);
    const leftUrl = (left <= totalPages) ? await renderPageToDataURL(left) : null;
    const rightUrl = (right <= totalPages) ? await renderPageToDataURL(right) : null;
    setPageImage(leftPage, leftUrl);
    setPageImage(rightPage, rightUrl);
    highlightThumb(left);
    setBusy(false);
  }

  async function buildThumbnails(){
    thumbs.innerHTML = '';
    const maxThumbs = Math.min(totalPages, 40);
    const step = totalPages > 40 ? Math.ceil(totalPages / 40) : 1;
    for (let p=1; p<=totalPages; p+=step){
      const img = document.createElement('img');
      img.dataset.p = p;
      img.alt = `Page ${p}`;
      img.src = '';
      thumbs.appendChild(img);
      (async (pp, el) => {
        const d = await renderPageToDataURL(pp, 0.7);
        el.src = d;
      })(p, img);
      img.addEventListener('click', () => {
        const left = (p % 2 === 1) ? p : Math.max(1, p-1);
        updateSpreadInstant(left);
      });
    }
  }

  function highlightThumb(left){
    [...thumbs.children].forEach(img => {
      const p = parseInt(img.dataset.p,10);
      img.classList.toggle('active', p === left || p === left+1);
    });
  }

  // Flip with 3D animation. Works for desktop and mobile; on very small screens we fallback to instant (CSS hides flipLayer)
  async function flipTo(newLeft){
    if (!pdfDoc) return;
    newLeft = Math.max(1, Math.min(newLeft, totalPages));
    if (newLeft === currentLeft) return;

    const forward = newLeft > currentLeft;

    // small screens: skip fancy flip if flipLayer hidden by CSS
    if (getComputedStyle(flipLayer).display === 'none') {
      await updateSpreadInstant(newLeft);
      return;
    }

    setBusy(true);
    const curLeft = currentLeft;
    const curRight = curLeft + 1;
    const nextLeft = newLeft;
    const nextRight = newLeft + 1;

    // pick pages for front/back faces
    const frontNum = forward ? curRight : nextLeft; // front face shows the page that flips away/into
    const backNum  = forward ? nextRight : curLeft;

    const frontUrl = (frontNum <= totalPages) ? await renderPageToDataURL(frontNum) : null;
    const backUrl  = (backNum <= totalPages) ? await renderPageToDataURL(backNum) : null;

    // set background images for faces
    flipFront.style.background = frontUrl ? `url('${frontUrl}') center/cover no-repeat` : '#fff';
    flipBack.style.background  = backUrl  ? `url('${backUrl}') center/cover no-repeat` : '#fff';

    // set origin & position
    flipLayer.style.left = forward ? '50%' : '0%';
    flipLayer.style.transformOrigin = forward ? 'left center' : 'right center';

    // ensure underlying pages reflect current spread while animating
    if (cache[curLeft]) setPageImage(leftPage, cache[curLeft]);
    if (cache[curRight]) setPageImage(rightPage, cache[curRight]);

    flipLayer.classList.add('show','flip-animate');
    // reset start angle
    flipLayer.style.transform = forward ? 'rotateY(0deg)' : 'rotateY(180deg)';

    // small tweak: shorten duration on narrow screens
    if (window.innerWidth < 900) {
      flipLayer.style.transitionDuration = '420ms';
    } else {
      flipLayer.style.transitionDuration = '700ms';
    }

    // trigger animation
    requestAnimationFrame(() => {
      flipLayer.style.transform = forward ? 'rotateY(-180deg)' : 'rotateY(0deg)';
    });

    // wait for transition end
    await new Promise(res => {
      const handler = (e) => {
        flipLayer.removeEventListener('transitionend', handler);
        res();
      };
      flipLayer.addEventListener('transitionend', handler);
    });

    flipLayer.classList.remove('show','flip-animate');
    flipLayer.style.transform = '';
    await updateSpreadInstant(newLeft);
    setBusy(false);
  }

  // UI handlers
  btnNext.addEventListener('click', ()=> {
    const newLeft = Math.min(totalPages, currentLeft + 2);
    flipTo(newLeft);
  });
  btnPrev.addEventListener('click', ()=> {
    const newLeft = Math.max(1, currentLeft - 2);
    flipTo(newLeft);
  });

  loadBtn.addEventListener('click', async ()=> {
    if (fileInput.files && fileInput.files.length > 0){
      const buf = await fileInput.files[0].arrayBuffer();
      await loadPdfData(buf);
    } else if (pdfUrlIn.value.trim()){
      await loadPdfUrl(pdfUrlIn.value.trim());
    } else {
      alert('Upload a PDF file or paste a PDF URL first.');
    }
  });

  async function loadPdfUrl(url){
    try {
      setBusy(true);
      cache = {};
      pdfDoc = await pdfjsLib.getDocument({ url }).promise;
      totalPages = pdfDoc.numPages;
      totalPagesEl.textContent = `of ${totalPages}`;
      currentLeft = 1;
      await buildThumbnails();
      await updateSpreadInstant(1);
    } catch(err){
      console.error(err);
      alert('Could not load PDF. Remote PDF may block CORS — try uploading locally.');
    } finally { setBusy(false); }
  }

  async function loadPdfData(arrayBuffer){
    try {
      setBusy(true);
      cache = {};
      pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      totalPages = pdfDoc.numPages;
      totalPagesEl.textContent = `of ${totalPages}`;
      currentLeft = 1;
      await buildThumbnails();
      await updateSpreadInstant(1);
    } catch(err){
      console.error(err);
      alert('Could not load file. It may be corrupt or not a valid PDF.');
    } finally { setBusy(false); }
  }

  // keyboard navigation
  window.addEventListener('keydown', (e)=> {
    if (e.key === 'ArrowRight') btnNext.click();
    if (e.key === 'ArrowLeft') btnPrev.click();
  });

  // touch swipe for mobile (simple)
  (function addTouch(){
    let startX = 0, startY = 0, moved = false;
    stage.addEventListener('touchstart', (ev)=> {
      if (ev.touches.length > 1) return;
      startX = ev.touches[0].clientX;
      startY = ev.touches[0].clientY;
      moved = false;
    }, {passive:true});
    stage.addEventListener('touchmove', (ev)=> {
      if (ev.touches.length > 1) return;
      const dx = ev.touches[0].clientX - startX;
      const dy = ev.touches[0].clientY - startY;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) moved = true;
    }, {passive:true});
    stage.addEventListener('touchend', (ev)=> {
      if (!moved) return;
      const endX = (ev.changedTouches && ev.changedTouches[0]) ? ev.changedTouches[0].clientX : startX;
      const dx = endX - startX;
      // swipe left => next, swipe right => prev (dx negative means swipe left)
      if (dx < -40) btnNext.click();
      else if (dx > 40) btnPrev.click();
    }, {passive:true});
  })();

  // handle resize: optionally re-render thumbnails/spread for better sharpness
  let rto = null;
  window.addEventListener('resize', ()=> {
    clearTimeout(rto);
    rto = setTimeout(async ()=> {
      if (!pdfDoc) return;
      // keep cache to avoid heavy re-render; for best sharpness you could clear cache here
      await buildThumbnails();
      await updateSpreadInstant(currentLeft);
    }, 300);
  });

  // expose helper (debug)
  window.flipbook = { loadPdfUrl, loadPdfData, updateSpreadInstant };

  // --- Auto-load local myfile.pdf when available (place myfile.pdf in same folder) ---
  document.addEventListener('DOMContentLoaded', function () {
    const defaultPdfPath = 'myfile.pdf'; // adjust path if you put it in subfolder, e.g. 'assets/myfile.pdf'

    // Quick HEAD check so console doesn't fill with errors if file missing
    fetch(defaultPdfPath, { method: 'HEAD' })
      .then(response => {
        if (response.ok) {
          // window.flipbook.loadPdfUrl is exposed by the main script
          if (window.flipbook && typeof window.flipbook.loadPdfUrl === 'function') {
            window.flipbook.loadPdfUrl(defaultPdfPath);
          }
        } else {
          // file not present — do nothing (user can upload or paste URL)
          console.info('Default PDF not found at', defaultPdfPath);
        }
      })
      .catch(err => {
        // network error or blocked by CORS — ignore silently
        console.info('Could not check default PDF:', err);
      });
  });

})();
