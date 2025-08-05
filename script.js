// script.js: client-side logic for the Universal Plotter

// Elements references
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('drop-zone');
const fileInfo = document.getElementById('file-info');
// Controls for selecting chart type and generating plot
const chartTypeSelect = document.getElementById('chartType');
const plotBtn = document.getElementById('plotBtn');
// Sidebar sections and lists
const fieldsSection = document.getElementById('fields-section');
const columnList = document.getElementById('columnList');
// Chart layout container and drop targets
const chartLayout = document.getElementById('chart-layout');
const dropX = document.getElementById('dropX');
const dropY = document.getElementById('dropY');
const dropGroup = document.getElementById('dropGroup');
// The Plotly plot area div
const plotArea = document.getElementById('plotArea');

// Selected keys for axes and grouping
let xKey = null;
let yKey = null;
let groupKey = null;

let parsedRows = [];

// We no longer use Chart.js, so no chart instance is stored

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

// Flatten a nested object into a single-level object with dot-separated keys. Arrays are flattened by index.
function flattenObject(obj, prefix = '') {
  const out = {};
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively flatten nested objects
      Object.assign(out, flattenObject(value, newKey));
    } else if (Array.isArray(value)) {
      // Flatten arrays by index
      value.forEach((item, index) => {
        if (item && typeof item === 'object') {
          Object.assign(out, flattenObject(item, `${newKey}[${index}]`));
        } else {
          out[`${newKey}[${index}]`] = item;
        }
      });
    } else {
      out[newKey] = value;
    }
  });
  return out;
}

/**
 * Convert a parsed JSON object into an array of flattened row objects. If the JSON
 * contains an array of objects, those objects become rows. If the JSON contains
 * a single object with a nested array property whose elements are objects (e.g.,
 * properties.periods in the weather example), then each element of that array
 * becomes a row and fields from the parent object are propagated into every row.
 *
 * @param {Object|Array} json The parsed JSON value
 * @returns {Array<Object>} Array of flattened row objects
 */
function parseJsonToRows(json) {
  const rows = [];
  // Find the first nested path that is an array of objects (e.g., properties.periods)
  function findObjectArrayPath(obj, currentPath = '') {
    // We want to find an array whose elements are plain objects (and not arrays)
    if (Array.isArray(obj) && obj.length > 0 && obj.every((el) => typeof el === 'object' && !Array.isArray(el))) {
      return currentPath;
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const k of Object.keys(obj)) {
        const val = obj[k];
        const path = currentPath ? `${currentPath}.${k}` : k;
        const found = findObjectArrayPath(val, path);
        if (found) return found;
      }
    }
    return null;
  }
  // Retrieve a nested value from an object using dot-separated path
  function getByPath(obj, path) {
    return path.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), obj);
  }
  // Remove a nested property from an object using dot-separated path
  function removePath(obj, path) {
    const parts = path.split('.');
    const last = parts.pop();
    const parent = parts.reduce((acc, key) => (acc ? acc[key] : undefined), obj);
    if (parent && typeof parent === 'object') {
      delete parent[last];
    }
  }
  if (Array.isArray(json)) {
    json.forEach((item) => {
      if (item && typeof item === 'object') {
        rows.push(flattenObject(item));
      } else {
        rows.push({ value: item });
      }
    });
  } else if (json && typeof json === 'object') {
    const arrayPath = findObjectArrayPath(json);
    if (arrayPath) {
      const arr = getByPath(json, arrayPath);
      // Deep copy of the JSON object so we can remove the array property without mutating the original
      const baseObj = JSON.parse(JSON.stringify(json));
      removePath(baseObj, arrayPath);
      const baseFlatten = flattenObject(baseObj);
      arr.forEach((el) => {
        if (el && typeof el === 'object') {
          const elFlatten = flattenObject(el);
          const prefixed = {};
          // Prefix each flattened key with the array path (e.g., properties.periods.startTime)
          Object.entries(elFlatten).forEach(([k, v]) => {
            prefixed[`${arrayPath}.${k}`] = v;
          });
          rows.push(Object.assign({}, baseFlatten, prefixed));
        } else {
          // Primitive element: assign directly to arrayPath
          const row = Object.assign({}, baseFlatten);
          row[arrayPath] = el;
          rows.push(row);
        }
      });
    } else {
      // No nested array of objects found; flatten entire object into one row
      rows.push(flattenObject(json));
    }
  }
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
        // Parse JSON and flatten nested objects/arrays into rows
        const json = JSON.parse(content);
        rows = parseJsonToRows(json);
      } else if (ext === 'xml') {
        rows = parseXmlToRows(content);
      } else {
        throw new Error('Unsupported file type');
      }
      parsedRows = rows;
      // Populate the draggable field list
      populateFieldList(rows);
      // Show field section (chart layout is always visible)
      fieldsSection.classList.remove('hidden');
      // Reset selected keys and UI
      xKey = null;
      yKey = null;
      groupKey = null;
      resetDropTargets();
      // Clear any existing Plotly graph
      Plotly.purge(plotArea);
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
  // Reset drop zones to their default hints
  dropY.textContent = 'Drop Y-axis here';
  dropX.textContent = 'Drop X-axis here';
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
  // Validate that X and Y axes are assigned
  if (!xKey || !yKey) {
    alert('Please assign both X and Y axes by dragging fields.');
    return;
  }
  if (!parsedRows || parsedRows.length === 0) {
    alert('No data available to plot');
    return;
  }
  const selectedType = chartTypeSelect.value; // 'line', 'bar', or 'scatter'
  // Determine if X values are numeric (useful for sorting)
  const numericX = isColumnNumeric(xKey);
  // Build traces based on grouping and chart type
  const traces = [];
  const colors = generateColors(groupKey ? Object.keys(groupRowsByKey(parsedRows, groupKey)).length : 1);

  if (groupKey) {
    const grouped = groupRowsByKey(parsedRows, groupKey);
    let colorIndex = 0;
    Object.entries(grouped).forEach(([groupName, rows]) => {
      const trace = buildTrace(rows, groupName, selectedType, colors[colorIndex]);
      traces.push(trace);
      colorIndex++;
    });
  } else {
    // Single trace without grouping
    const trace = buildTrace(parsedRows, `${yKey} vs ${xKey}`, selectedType, colors[0]);
    traces.push(trace);
  }
  // Build layout configuration with axis titles and interactive mode bar
  const layout = {
    title: `${yKey} vs ${xKey}`,
    xaxis: { title: xKey },
    yaxis: { title: yKey },
    legend: { orientation: 'v', x: 1.02, y: 1 },
    margin: { l: 60, r: 60, t: 40, b: 60 },
    hovermode: 'closest',
    autosize: true,
  };
  const config = {
    responsive: true,
    scrollZoom: true, // allow mouse wheel zooming
    displaylogo: false, // hide plotly logo
    modeBarButtonsToRemove: ['toImage'],
  };
  // Clear any existing chart and draw a new one
  Plotly.react(plotArea, traces, layout, config);
}

/**
 * Group rows by the specified key. Returns an object with group names as keys
 * and arrays of row objects as values.
 * @param {Array<Object>} rows
 * @param {string} key
 */
function groupRowsByKey(rows, key) {
  return rows.reduce((acc, row) => {
    const group = row[key];
    if (!acc[group]) acc[group] = [];
    acc[group].push(row);
    return acc;
  }, {});
}

/**
 * Build a Plotly trace from a set of rows using the global xKey and yKey.
 * Chooses trace type and mode based on selected chart type.
 * @param {Array<Object>} rows
 * @param {string} name
 * @param {string} type
 * @param {string} color
 */
function buildTrace(rows, name, type, color) {
  const xData = [];
  const yData = [];
  rows.forEach((row) => {
    let xVal = row[xKey];
    let yVal = row[yKey];
    // Convert numeric strings to numbers for proper axis scaling
    if (isNumeric(xVal)) xVal = parseFloat(xVal);
    if (isNumeric(yVal)) yVal = parseFloat(yVal);
    xData.push(xVal);
    yData.push(yVal);
  });
  // Determine Plotly trace type and mode
  let traceType;
  let mode;
  if (type === 'bar') {
    traceType = 'bar';
    mode = undefined;
  } else if (type === 'line') {
    traceType = 'scatter';
    mode = 'lines+markers';
  } else {
    traceType = 'scatter';
    mode = 'markers';
  }
  return {
    x: xData,
    y: yData,
    type: traceType,
    mode: mode,
    name: name,
    marker: { color: color },
  };
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

// Render an initial blank plot on page load so that the plot area and axes drop zones are visible.
document.addEventListener('DOMContentLoaded', () => {
  const initialLayout = {
    title: '',
    xaxis: { title: '' },
    yaxis: { title: '' },
    margin: { l: 60, r: 60, t: 20, b: 60 },
  };
  const initialConfig = {
    responsive: true,
    displaylogo: false,
  };
  // Draw an empty plot
  Plotly.newPlot(plotArea, [], initialLayout, initialConfig);
});