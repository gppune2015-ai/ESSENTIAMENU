// Use your PDF file uploaded to GitHub Pages
const PDF_URL = "myfile.pdf"; // <-- your PDF filename here

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@2.16.105/build/pdf.worker.min.js";

let pdfDoc = null;
let currentPage = 1;

const flipbook = document.getElementById("flipbook");
const pageIndicator = document.getElementById("pageIndicator");

// Render a page
function renderPage(pageNum) {
  pdfDoc.getPage(pageNum).then((page) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const viewport = page.getViewport({ scale: 1.4 });

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    flipbook.innerHTML = "";
    flipbook.appendChild(canvas);

    page.render({ canvasContext: context, viewport: viewport });

    pageIndicator.innerText = `Page ${pageNum} / ${pdfDoc.numPages}`;
  });
}

// Load PDF
pdfjsLib.getDocument(PDF_URL).promise
  .then((pdf) => {
    pdfDoc = pdf;
    renderPage(currentPage);
  })
  .catch((err) => {
    flipbook.innerHTML = `<p style="color:red;">
      ? Failed to load PDF. Make sure the file exists in the same folder.
    </p>`;
    console.error(err);
  });

// Navigation buttons
document.getElementById("prevBtn").onclick = () => {
  if (currentPage <= 1) return;
  currentPage--;
  renderPage(currentPage);
};

document.getElementById("nextBtn").onclick = () => {
  if (currentPage >= pdfDoc.numPages) return;
  currentPage++;
  renderPage(currentPage);
};
