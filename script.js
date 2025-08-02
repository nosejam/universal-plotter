// script.js: client-side logic for the Universal Plotter

// Elements references
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('drop-zone');
const fileInfo = document.getElementById('file-info');
const chartSection = document.getElementById('chart-section');
const chartCanvas = document.getElementById('chartCanvas');
const chartTypeSelect = document.getElementById('chartType');
const plotBtn = document.getElementById('plotBtn');
// New UI elements for fields and drag‑and‑drop
const fieldsSection = document.getElementById('fields-section');
const columnList = document.getElementById('columnList');
const dropSection = document.getElementById('drop-section');
const dropX = document.getElementById('dropX');
const dropY = document.getElementById('dropY');
const dropGroup = document.getElementById('dropGroup');

// Selected keys for axes and grouping
let xKey = null;
let yKey = null;
let groupKey = null;

let parsedRows = [];
let chartInstance = null;

// Register the Chart.js zoom plugin if available
if (typeof Chart !== 'undefined' && typeof window !== 'undefined') {
  // The plugin is loaded via CDN and attached to window under chartjsPluginZoom or chartjs-plugin-zoom key
  const zoomPlugin = window['chartjs-plugin-zoom'] || window['chartjsPluginZoom'];
  if (zoomPlugin) {
    Chart.register(zoomPlugin);
  }
}

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
      // Populate the draggable field list
      populateFieldList(rows);
      // Show field and drop sections
      fieldsSection.classList.remove('hidden');
      dropSection.classList.remove('hidden');
      // Reset selected keys and UI
      xKey = null;
      yKey = null;
      groupKey = null;
      resetDropTargets();
      // Reset chart
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

// Populate the field list for drag‑and‑drop
function populateFieldList(rows) {
  columnList.innerHTML = '';
  if (!rows || rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  keys.forEach((key) => {
    const li = document.createElement('li');
    li.textContent = key;
    li.setAttribute('draggable', 'true');
    li.dataset.key = key;
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', key);
    });
    columnList.appendChild(li);
  });
}

// Reset drop targets to default text
function resetDropTargets() {
  dropX.textContent = 'Drop field here';
  dropY.textContent = 'Drop field here';
  dropGroup.textContent = '(optional)';
  dropX.classList.remove('filled');
  dropY.classList.remove('filled');
  dropGroup.classList.remove('filled');
}

// Determine if a value is numeric
function isNumeric(value) {
  return !isNaN(parseFloat(value)) && isFinite(value);
}

// Determine if every value in column is numeric
function isColumnNumeric(key) {
  return parsedRows.every((row) => isNumeric(row[key]));
}

// Generate a palette of distinct colors
function generateColors(count) {
  const palette = [
    '#026aa7',
    '#de3163',
    '#ff7f50',
    '#3cb371',
    '#ffa500',
    '#9370db',
    '#20b2aa',
    '#ff6347',
    '#4682b4',
    '#f08080',
  ];
  const colors = [];
  for (let i = 0; i < count; i++) {
    colors.push(palette[i % palette.length]);
  }
  return colors;
}


// Create and display chart
function renderChart() {
  if (!xKey || !yKey) {
    alert('Please assign both X and Y axes by dragging fields.');
    return;
  }
  if (!parsedRows || parsedRows.length === 0) {
    alert('No data available to plot');
    return;
  }
  const selectedType = chartTypeSelect.value;
  const ctx = chartCanvas.getContext('2d');
  // Build datasets based on grouping and chart type
  const numericX = isColumnNumeric(xKey);
  let chartConfig = null;
  const baseOptions = {
    responsive: true,
    plugins: {
      legend: {
        display: true,
      },
      tooltip: {
        callbacks: {},
      },
      // Enable pan and zoom
      zoom: {
        pan: {
          enabled: true,
          mode: 'xy',
        },
        zoom: {
          wheel: {
            enabled: true,
          },
          pinch: {
            enabled: true,
          },
          mode: 'xy',
        },
      },
    },
    scales: {},
  };
  // Remove existing chart
  if (chartInstance) {
    chartInstance.destroy();
  }
  // Grouping logic
  if (groupKey) {
    // Build groups
    const groupMap = {};
    parsedRows.forEach((row) => {
      const g = row[groupKey];
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(row);
    });
    const groupNames = Object.keys(groupMap);
    const colors = generateColors(groupNames.length);
    // If numeric X values or scatter chart selected, use scatter datasets per group
    if (numericX || selectedType === 'scatter') {
      const datasets = groupNames.map((g, idx) => {
        const data = groupMap[g]
          .filter((row) => isNumeric(row[yKey]) && isNumeric(row[xKey]))
          .map((row) => ({ x: parseFloat(row[xKey]), y: parseFloat(row[yKey]) }));
        return {
          label: g,
          data: data,
          borderColor: colors[idx],
          backgroundColor: colors[idx] + '80',
          showLine: selectedType === 'line',
          fill: selectedType === 'bar',
        };
      });
      chartConfig = {
        type: 'scatter',
        data: { datasets },
        options: Object.assign({}, baseOptions, {
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: xKey },
            },
            y: {
              type: 'linear',
              title: { display: true, text: yKey },
            },
          },
        }),
      };
    } else {
      // Non-numeric X: categories with groups for line/bar charts
      const labelSet = new Set();
      parsedRows.forEach((row) => {
        labelSet.add(String(row[xKey]));
      });
      const labels = Array.from(labelSet);
      const datasets = groupNames.map((g, idx) => {
        const data = labels.map((label) => {
          const row = groupMap[g].find((r) => String(r[xKey]) === label);
          return row && isNumeric(row[yKey]) ? parseFloat(row[yKey]) : null;
        });
        return {
          label: g,
          data,
          borderColor: colors[idx],
          backgroundColor: colors[idx] + '80',
          fill: selectedType === 'bar',
        };
      });
      chartConfig = {
        type: selectedType,
        data: { labels, datasets },
        options: Object.assign({}, baseOptions, {
          scales: {
            x: {
              type: 'category',
              title: { display: true, text: xKey },
            },
            y: {
              title: { display: true, text: yKey },
            },
          },
        }),
      };
    }
  } else {
    // No grouping
    if (selectedType === 'scatter' || numericX) {
      // Scatter or numeric line/bar: treat as scatter
      const data = parsedRows
        .filter((row) => isNumeric(row[yKey]) && isNumeric(row[xKey]))
        .map((row) => ({ x: parseFloat(row[xKey]), y: parseFloat(row[yKey]) }));
      chartConfig = {
        type: 'scatter',
        data: {
          datasets: [
            {
              label: `${yKey} vs ${xKey}`,
              data,
              borderColor: '#026aa7',
              backgroundColor: 'rgba(2,106,167,0.4)',
              showLine: selectedType === 'line',
              fill: selectedType === 'bar',
            },
          ],
        },
        options: Object.assign({}, baseOptions, {
          scales: {
            x: {
              type: 'linear',
              title: { display: true, text: xKey },
            },
            y: {
              type: 'linear',
              title: { display: true, text: yKey },
            },
          },
        }),
      };
    } else {
      // Categorical line/bar without grouping
      const labels = parsedRows.map((row) => String(row[xKey]));
      const data = parsedRows.map((row) => (isNumeric(row[yKey]) ? parseFloat(row[yKey]) : null));
      chartConfig = {
        type: selectedType,
        data: {
          labels: labels,
          datasets: [
            {
              label: yKey,
              data,
              borderColor: '#026aa7',
              backgroundColor: 'rgba(2,106,167,0.4)',
              fill: selectedType === 'bar',
            },
          ],
        },
        options: Object.assign({}, baseOptions, {
          scales: {
            x: {
              type: 'category',
              title: { display: true, text: xKey },
            },
            y: {
              title: { display: true, text: yKey },
            },
          },
        }),
      };
    }
  }
  chartInstance = new Chart(ctx, chartConfig);
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

// Setup drag‑and‑drop for axis and group targets
function setupDropTarget(target, assignFn) {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    target.classList.add('dragover');
  });
  target.addEventListener('dragleave', () => {
    target.classList.remove('dragover');
  });
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    target.classList.remove('dragover');
    const key = e.dataTransfer.getData('text/plain');
    if (key) {
      assignFn(key);
      target.textContent = key;
      target.classList.add('filled');
    }
  });
}

setupDropTarget(dropX, (key) => {
  xKey = key;
});
setupDropTarget(dropY, (key) => {
  yKey = key;
});
setupDropTarget(dropGroup, (key) => {
  groupKey = key;
});