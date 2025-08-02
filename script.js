// script.js: client-side logic for the Universal Plotter

// Elements references
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('drop-zone');
const fileInfo = document.getElementById('file-info');
const optionsSection = document.getElementById('options-section');
const chartSection = document.getElementById('chart-section');
const chartCanvas = document.getElementById('chartCanvas');
const chartTypeSelect = document.getElementById('chartType');
const xSelect = document.getElementById('xSelect');
const ySelect = document.getElementById('ySelect');
const plotBtn = document.getElementById('plotBtn');

let parsedRows = [];
let chartInstance = null;

// Utility to detect file type by extension
function getFileExtension(name) {
  const idx = name.lastIndexOf('.');
  if (idx === -1) return '';
  return name.substring(idx + 1).toLowerCase();
}

// Convert a NodeList to array for iteration
function nodeListToArray(nodelist) {
  return Array.prototype.slice.call(nodelist);
}

// Simple XML to array-of-objects converter
function parseXmlToRows(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
  // Handle parse errors
  const parsererror = xmlDoc.getElementsByTagName('parsererror');
  if (parsererror.length) {
    throw new Error('Error parsing XML file');
  }
  const root = xmlDoc.documentElement;
  const children = nodeListToArray(root.children);
  // Determine row elements: if root has many children with same tag name, treat those as rows
  // If there is only one level of children and they have further children, treat those children as fields
  const rows = [];
  children.forEach((child) => {
    const rowObj = {};
    // Include attributes
    if (child.attributes) {
      nodeListToArray(child.attributes).forEach((attr) => {
        rowObj[attr.name] = attr.value;
      });
    }
    // Include child elements or text
    if (child.children.length > 0) {
      nodeListToArray(child.children).forEach((sub) => {
        const text = sub.textContent?.trim();
        rowObj[sub.tagName] = text;
      });
    } else {
      const text = child.textContent?.trim();
      if (text) {
        rowObj[child.tagName] = text;
      }
    }
    if (Object.keys(rowObj).length > 0) rows.push(rowObj);
  });
  return rows;
}

// Handler for file reading
function handleFile(file) {
  const ext = getFileExtension(file.name);
  fileInfo.textContent = `Loaded: ${file.name}`;
  fileInfo.classList.remove('hidden');
  const reader = new FileReader();
  reader.onload = function (e) {
    const content = e.target.result;
    try {
      let rows;
      if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
        // Use PapaParse for robust parsing. Detect delimiter automatically.
        const result = Papa.parse(content, {
          header: true,
          dynamicTyping: false,
          skipEmptyLines: true,
          delimiter: ext === 'tsv' ? '\t' : '', // auto for csv, tsv for ts
        });
        if (result.errors && result.errors.length) {
          console.warn(result.errors);
        }
        rows = result.data;
      } else if (ext === 'json') {
        const json = JSON.parse(content);
        if (Array.isArray(json)) {
          rows = json;
        } else if (typeof json === 'object' && json !== null) {
          // If object with array property: choose first property containing array
          const arrayKey = Object.keys(json).find((key) => Array.isArray(json[key]));
          if (arrayKey) {
            rows = json[arrayKey];
          } else {
            // wrap into array
            rows = [json];
          }
        } else {
          throw new Error('Unsupported JSON structure');
        }
      } else if (ext === 'xml') {
        rows = parseXmlToRows(content);
      } else {
        throw new Error('Unsupported file type');
      }
      parsedRows = rows;
      populateSelects(rows);
      optionsSection.classList.remove('hidden');
      // Reset chart section
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      chartSection.classList.add('hidden');
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };
  reader.readAsText(file);
}

// Populate x and y selects based on parsed rows
function populateSelects(rows) {
  xSelect.innerHTML = '';
  ySelect.innerHTML = '';
  if (!rows || rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  keys.forEach((key) => {
    const optionX = document.createElement('option');
    optionX.value = key;
    optionX.textContent = key;
    xSelect.appendChild(optionX);
    const optionY = document.createElement('option');
    optionY.value = key;
    optionY.textContent = key;
    ySelect.appendChild(optionY);
  });
}

// Determine if a value is numeric
function isNumeric(value) {
  return !isNaN(parseFloat(value)) && isFinite(value);
}

// Build dataset for Chart.js
function buildChartData(xKey, yKey) {
  const labels = [];
  const dataY = [];
  const scatterData = [];
  let numericX = true;
  parsedRows.forEach((row) => {
    const xv = row[xKey];
    const yv = row[yKey];
    if (isNumeric(xv)) {
      labels.push(parseFloat(xv));
    } else {
      numericX = false;
      labels.push(String(xv));
    }
    if (isNumeric(yv)) {
      dataY.push(parseFloat(yv));
    } else {
      dataY.push(null);
    }
    scatterData.push({ x: isNumeric(xv) ? parseFloat(xv) : xv, y: isNumeric(yv) ? parseFloat(yv) : yv });
  });
  return { labels, dataY, scatterData, numericX };
}

// Create and display chart
function renderChart() {
  const chartType = chartTypeSelect.value;
  const xKey = xSelect.value;
  const yKey = ySelect.value;
  const { labels, dataY, scatterData, numericX } = buildChartData(xKey, yKey);
  const ctx = chartCanvas.getContext('2d');
  if (chartInstance) {
    chartInstance.destroy();
  }
  // Determine dataset based on chart type
  let config;
  if (chartType === 'scatter') {
    config = {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: `${yKey} vs ${xKey}`,
            data: scatterData,
            backgroundColor: 'rgba(2,106,167,0.6)',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true,
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const xVal = context.parsed.x;
                const yVal = context.parsed.y;
                return `(${xKey}: ${xVal}, ${yKey}: ${yVal})`;
              },
            },
          },
        },
        scales: {
          x: {
            type: numericX ? 'linear' : 'category',
            title: {
              display: true,
              text: xKey,
            },
          },
          y: {
            type: 'linear',
            title: {
              display: true,
              text: yKey,
            },
          },
        },
      },
    };
  } else {
    // line or bar
    config = {
      type: chartType,
      data: {
        labels: labels,
        datasets: [
          {
            label: yKey,
            data: dataY,
            borderColor: 'rgba(2,106,167,0.8)',
            backgroundColor: 'rgba(2,106,167,0.3)',
            fill: chartType === 'line' ? false : true,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true,
          },
          tooltip: {
            callbacks: {
              title: function (items) {
                if (!items.length) return '';
                const index = items[0].dataIndex;
                return `${xKey}: ${labels[index]}`;
              },
              label: function (context) {
                return `${yKey}: ${context.parsed.y}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: numericX ? 'linear' : 'category',
            title: {
              display: true,
              text: xKey,
            },
          },
          y: {
            title: {
              display: true,
              text: yKey,
            },
          },
        },
      },
    };
  }
  chartInstance = new Chart(ctx, config);
  chartSection.classList.remove('hidden');
}

// Event listeners
fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    handleFile(e.target.files[0]);
  }
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    handleFile(e.dataTransfer.files[0]);
  }
});

// Plot button event
plotBtn.addEventListener('click', () => {
  if (!parsedRows || parsedRows.length === 0) {
    alert('No data available to plot');
    return;
  }
  renderChart();
});