const PDF_URL = "myfile.pdf"; // your PDF filename
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js";

let pdfDoc = null;
let currentPage = 1;

const pageFront = document.getElementById("pageFront");
const pageBack = document.getElementById("pageBack");
const flipbook = document.getElementById("flipbook");

function renderPDFPage(pageNum, container) {
  pdfDoc.getPage(pageNum).then(page => {
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    container.innerHTML = "";
    container.appendChild(canvas);
    page.render({ canvasContext: ctx, viewport: viewport });
  });
}

function showPage(pageNum) {
  if (!pdfDoc) return;

  renderPDFPage(pageNum, pageFront);

  // Back page preview
  if (pageNum + 1 <= pdfDoc.numPages) {
    renderPDFPage(pageNum + 1, pageBack);
  } else {
    pageBack.innerHTML = "";
  }

  flipbook.style.transform = "rotateY(0deg)";
}

// Flip to next page
function nextPage() {
  if (currentPage + 1 > pdfDoc.numPages) return;
  flipbook.style.transform = "rotateY(-180deg)";
  setTimeout(() => {
    currentPage += 2;
    showPage(currentPage);
  }, 400);
}

// Flip to previous page
function prevPage() {
  if (currentPage - 2 < 1) return;
  flipbook.style.transform = "rotateY(180deg)";
  setTimeout(() => {
    currentPage -= 2;
    showPage(currentPage);
  }, 400);
}

document.getElementById("nextBtn").onclick = nextPage;
document.getElementById("prevBtn").onclick = prevPage;

// Load PDF
pdfjsLib.getDocument(PDF_URL).promise
  .then(pdf => {
    pdfDoc = pdf;
    showPage(currentPage);
  })
  .catch(err => {
    pageFront.innerHTML = `<p style="color:red;">❌ Could not load PDF</p>`;
    console.error(err);
  });
