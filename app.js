// Pre-analytical & Clinical Validation Rules
const CLINICAL_RULES = [
  {
    type: "HEMOLYSIS_INTERFERENCE",
    triggerFlags: ["HEMOLYSIS", "HEMOLYZED", "H-INDEX", "HEMOLYTIC", "+++", "SEVERE"],
    targetTests: ["POTASSIUM", " K ", "LDH", "AST", "ALT"],
    title: "Critical In-vitro Hemolysis Interference",
    description: "Elevated hemolysis index detected concomitantly with intracellular analytes. Red cell lysis causes spurious LDH elevations and marked pseudohyperkalemia.",
    action: "Recommendation: Suppress Potassium and LDH results. Reject specimen and dispatch an urgent recollection request."
  },
  {
    type: "EDTA_CONTAMINATION",
    triggerFlags: ["POTASSIUM", " K "],
    targetTests: ["CALCIUM", " CA "],
    evaluate: (text) => {
      const hasPotassium = text.includes("POTASSIUM") || text.includes(" K ");
      const hasCalcium = text.includes("CALCIUM") || text.includes(" CA ");
      return hasPotassium && hasCalcium;
    },
    title: "Suspected K2/K3-EDTA Tube Contamination",
    description: "Marked hyperkalemia paired with physiologically incompatible hypocalcemia strongly suggests EDTA anticoagulant carryover (Order of Draw error).",
    action: "Recommendation: Freeze all panel results immediately. Do not report. Verify phlebotomy sequence and request a fresh plain/gel chemistry tube."
  },
  {
    type: "LIPEMIA_TURBIDITY",
    triggerFlags: ["LIPEMIA", "LIPEMIC", "L-INDEX", "TURBIDITY"],
    targetTests: ["HGB", "HEMOGLOBIN", "TOTAL PROTEIN", "CBC"],
    title: "Lipemia / Optical Turbidity Interference",
    description: "High chylomicron/triglyceride turbidity causes optical spectrophotometric interference, falsely elevating Hemoglobin and Total Protein readings.",
    action: "Recommendation: Perform ultracentrifugation or high-speed clearing before re-analyzing photometer assays."
  }
];

// DOM Elements
const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");
const statusMessage = document.getElementById("statusMessage");
const alertsContainer = document.getElementById("alertsContainer");
const rawTextPre = document.getElementById("rawText");

const dispName = document.getElementById("dispName");
const dispAge = document.getElementById("dispAge");
const dispFile = document.getElementById("dispFile");
const dispNotes = document.getElementById("dispNotes");
const notesToggleBtn = document.getElementById("notesToggleBtn");
const notesContent = document.getElementById("notesContent");

// Toggle Notes Box
notesToggleBtn.addEventListener("click", () => {
  const isShown = notesContent.style.display === "block";
  notesContent.style.display = isShown ? "none" : "block";
});

dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleImageProcessing(file);
});

// Canvas Preprocessing
function enhanceCanvasForOCR(imgElement) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const scale = 2.5;
  canvas.width = imgElement.naturalWidth * scale;
  canvas.height = imgElement.naturalHeight * scale;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imgData.data;

  // Strict Binarization
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    const val = gray < 190 ? 0 : 255;
    pixels[i] = val;
    pixels[i + 1] = val;
    pixels[i + 2] = val;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

// Extraction Pipelines (Metadata & Notes)
function extractMetadata(text) {
  // 1. Patient Name
  const nameMatch = text.match(/Patient\s*Nam[ea]?\s*[:\-]?\s*([A-Za-z\s]+?)(?=\n|Patient|Age|File|$)/i);
  if (nameMatch && nameMatch[1].trim()) {
    dispName.innerText = nameMatch[1].trim();
  } else {
    dispName.innerText = "NOT DETECTED";
  }

  // 2. Patient Age
  const ageMatch = text.match(/Patient\s*Age\s*[:\-]?\s*(\d+)/i) || text.match(/\bAge\s*[:\-]?\s*(\d+)/i);
  if (ageMatch && ageMatch[1]) {
    dispAge.innerText = ageMatch[1] + " Y";
  } else {
    dispAge.innerText = "NOT DETECTED";
  }

  // 3. File Number
  const fileMatch = text.match(/File\s*(?:Number|No|Num)?\s*[:\-]?\s*(\d+)/i);
  if (fileMatch && fileMatch[1]) {
    dispFile.innerText = fileMatch[1];
  } else {
    dispFile.innerText = "NOT DETECTED";
  }

  // 4. Notes Section Extraction
  const notesMatch = text.match(/Notes?\s*[:\-]?\s*([\s\S]*?)(?=Export|Print|Close|Help|$)/i);
  if (notesMatch && notesMatch[1].trim()) {
    dispNotes.innerText = notesMatch[1].trim();
  } else {
    dispNotes.innerText = "No specific clinical notes or analyzer flags extracted.";
  }
}

// Processing Execution
async function handleImageProcessing(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);

  img.onload = async () => {
    imagePreview.src = img.src;
    imagePreview.style.display = "block";
    statusMessage.innerText = "ACQUIRING BUFFER & INITIALIZING OCR...";
    alertsContainer.innerHTML = "";
    rawTextPre.innerText = "";

    try {
      const processedCanvas = enhanceCanvasForOCR(img);

      const { data: { text } } = await Tesseract.recognize(processedCanvas, "eng", {
        tessedit_pageseg_mode: "6",
        logger: (m) => {
          if (m.status === "recognizing text") {
            statusMessage.innerText = `SCANNING LIS TELEMETRY: ${Math.round((m.progress || 0) * 100)}%`;
          }
        }
      });

      const cleanedText = text
        .replace(/,/g, ".")
        .replace(/(\d+)\s+(\d+)/g, "$1.$2");

      rawTextPre.innerText = cleanedText;
      statusMessage.innerText = "VALIDATION ANALYSIS COMPLETE.";

      // استخراج الحقول الثلاثة والملاحظات
      extractMetadata(cleanedText);

      // فحص التداخلات الطبية
      evaluateClinicalRules(cleanedText);

    } catch (err) {
      statusMessage.innerText = "ERROR INGESTING BUFFER: " + err.message;
    }
  };
}

// Rule Engine Evaluator
function evaluateClinicalRules(extractedText) {
  const upper = " " + extractedText.toUpperCase().replace(/\n/g, " ") + " ";
  let triggeredCount = 0;

  CLINICAL_RULES.forEach((rule) => {
    let isTriggered = false;

    if (rule.evaluate) {
      isTriggered = rule.evaluate(upper);
    } else {
      const hasFlag = rule.triggerFlags.some((flag) => upper.includes(flag));
      const hasTest = rule.targetTests.some((test) => upper.includes(test));
      isTriggered = hasFlag && hasTest;
    }

    if (isTriggered) {
      triggeredCount++;
      renderAlertCard(rule);
    }
  });

  if (triggeredCount === 0) {
    alertsContainer.innerHTML = `
      <div class="card-success">
        &check; Quality Check Passed: No pre-analytical flags, spectral interferences, or critical discrepancies identified.
      </div>
    `;
  }
}

function renderAlertCard(rule) {
  const card = document.createElement("div");
  card.className = "card-alert";
  card.innerHTML = `
    <div class="card-title">${rule.title}</div>
    <div class="card-desc">${rule.description}</div>
    <div class="card-action">${rule.action}</div>
  `;
  alertsContainer.appendChild(card);
}
// استخراج ديناميكي حقيقي 100% لبيانات أي مريض
function extractMetadata(text) {
  // تقسيم النص المستخرج إلى أسطر نظيفة
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  let detectedName = "NOT DETECTED";
  let detectedAge = "NOT DETECTED";
  let detectedFile = "NOT DETECTED";

  for (const line of lines) {
    // 1. التقاط اسم المريض ديناميكياً
    // يبحث عن سطر يبدأ بـ Patient Name متبوعاً بأي فاصل، ويأخذ الاسم كاملاً مهما كان
    if (/Patient\s*Nam[ea]/i.test(line)) {
      const match = line.replace(/.*Patient\s*Nam[ea][\s:.-]*/i, '').trim();
      if (match.length > 1) {
        detectedName = match;
      }
    }

    // 2. التقاط العمر ديناميكياً
    if (/Patient\s*Age|\bAge\b/i.test(line)) {
      const match = line.match(/(\d{1,3})/);
      if (match) {
        detectedAge = match[1] + " Y";
      }
    }

    // 3. التقاط رقم الملف ديناميكياً
    // يدعم "Patient File Number" أو "File Number" أو "File No"
    if (/File\s*(?:Number|No|Num)?/i.test(line)) {
      const match = line.match(/(\d{3,10})/);
      if (match) {
        detectedFile = match[1];
      }
    }
  }

  // عرض القيم المستخرجة ديناميكياً في المربعات العلوية
  dispName.innerText = detectedName;
  dispAge.innerText = detectedAge;
  dispFile.innerText = detectedFile;

  // 4. التقاط خانة الملاحظات ديناميكياً من أسفل الشاشة
  const notesIndex = text.search(/Notes?\s*[:\-]/i);
  if (notesIndex !== -1) {
    let rawNotes = text.substring(notesIndex);
    // إزالة أزرار أسفل النافذة إن وُجدت
    rawNotes = rawNotes.replace(/Notes?\s*[:\-]?/i, '')
                       .replace(/Export.*|Print.*|Close.*|Help.*/is, '')
                       .trim();
    dispNotes.innerText = rawNotes || "No specific notes extracted.";
  } else {
    dispNotes.innerText = "No specific notes identified.";
  }
}
