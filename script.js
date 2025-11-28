const PDF_URL = "myfile.pdf"; // must match exact filename in repo

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js";

let pdfDoc = null;
let currentPage = 1;

const canvas = document.getElementById("pdfCanvas");
const ctx = canvas.getContext("2d");

// Render a PDF page
function renderPage(pageNum) {
  pdfDoc.getPage(pageNum).then(page => {
    const viewport = page.getViewport({ scale: 1.2 });

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const renderCtx = { canvasContext: ctx, viewport: viewport };
    
    // Flip animation
    canvas.style.transform = "rotateY(180deg)";
    setTimeout(() => page.render(renderCtx), 50);
    setTimeout(() => {
      canvas.style.transform = "rotateY(0deg)";
      canvas.style.transition = "transform 0.6s ease";
    }, 100);
  });
}

// Next page
function nextPage() {
  if (currentPage >= pdfDoc.numPages) return;
  currentPage++;
  renderPage(currentPage);
}

// Previous page
function prevPage() {
  if (currentPage <= 1) return;
  currentPage--;
  renderPage(currentPage);
}

document.getElementById("nextBtn").onclick = nextPage;
document.getElementById("prevBtn").onclick = prevPage;

// Load PDF
pdfjsLib.getDocument(PDF_URL).promise
  .then(pdf => {
    pdfDoc = pdf;
    renderPage(currentPage);
  })
  .catch(err => {
    canvas.style.display = "none";
    alert("❌ Could not load PDF. Check filename/path.");
    console.error(err);
  });
