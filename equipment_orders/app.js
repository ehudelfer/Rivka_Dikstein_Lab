'use strict';

// Firebase web configuration is public; never put service-account keys here.
const firebaseConfig = {
    apiKey: 'AIzaSyBm7oyOtqfP2bPRrLay0mVM1SSqVMtd_lE',
    authDomain: 'rivka-dikstein.firebaseapp.com',
    databaseURL: 'https://rivka-dikstein-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'rivka-dikstein',
    storageBucket: 'rivka-dikstein.firebasestorage.app',
    messagingSenderId: '280677399153',
    appId: '1:280677399153:web:7fc088d9ee87ac362439d0',
    measurementId: 'G-3YTFQ5M22E'
};

const storageKey = 'dikstein-lab-orders-v1';
const members = ['Prof. Rivka Dikstein', 'Dr. Anat Bahat', 'Dr. Ariel Ogran', 'Dr. Benjamin Weiss', 'Daniella Dayagi', 'Ehud Elfer', 'Elad Itzhaki', 'Elad Kotler', 'Marina Pinsker', 'Raaya Rosenbaum', 'Saja Saaida'];
const groups = ['Weizmann Warehouse', 'External Supplier'];
const statuses = ['Pending', 'Ordered', 'Delivered', 'Cancelled'];
const columns = [
    ['insertDate', 'Insert Date'], ['memberName', 'Lab Member Name'], ['orderedItem', 'Ordered Item'],
    ['quantity', 'Quantity'], ['productName', 'Product Name'], ['serialNumber', 'Serial Number'],
    ['sortingGroup', 'Sorting Group'], ['deliveryDate', 'Expected Delivery Date'], ['status', 'Status']
];
const optional = new Set(['productName', 'serialNumber', 'deliveryDate', 'quantity']);
const $ = id => document.getElementById(id);
let orders = [];
let mode = 'starting';
let connected = false;
let readable = false;
let busy = false;
let editing = null;
let editControls = null;
let realtime;
let database;
let ordersRef;
let cloudConnected = false;
let cloudReady = false;
let cloudError = false;

function showMessage(text, error = false) {
    $('message').textContent = text;
    $('message').classList.toggle('error', error);
}
function setStatus(text) {
    $('syncStatus').textContent = text;
}
function updateCloudStatus() {
    connected = cloudConnected && cloudReady && !cloudError;
    setStatus(cloudError ? 'Sync Error' : connected ? 'Live Cloud Sync Active' : 'Offline / connecting');
    $('emptyState').textContent = !connected
        ? 'No cached orders are available. Connect to see the shared table.'
        : 'No orders yet. New orders will appear here.';
    updateControls();
}
function updateControls() {
    const writable = connected && !busy;
    document.querySelectorAll('[data-mutation]').forEach(button => { button.disabled = !writable || Boolean(editing); });
    document.querySelectorAll('[data-export]').forEach(button => { button.disabled = !readable; });
    document.querySelectorAll('#orderForm input, #orderForm select, #orderForm button').forEach(element => {
        element.disabled = element.hasAttribute('data-mutation') ? !writable || Boolean(editing) : busy;
    });
    document.querySelectorAll('#tableBody button').forEach(button => {
        button.disabled = button.dataset.action === 'cancel' ? busy
            : !writable || button.dataset.conflict === 'true' || (Boolean(editing) && button.dataset.action === 'other');
    });
}
function today() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}
function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function newId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function validateOrder(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Each order must be an object.');
    const id = item.id === undefined ? newId() : item.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid order ID.');
    const order = { id };
    for (const [key, label] of columns) {
        if (key === 'quantity') {
            const value = item[key] === undefined ? 1 : item[key];
            if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
                throw new Error('Quantity must be a positive whole number.');
            }
            order[key] = Number(value);
            continue;
        }
        const value = item[key] === undefined && optional.has(key) ? '' : item[key];
        if (typeof value !== 'string') throw new Error(`${label} must be text.`);
        order[key] = value.trim();
        if (!optional.has(key) && !order[key]) throw new Error(`${label} is required.`);
    }
    if (!validDate(order.insertDate) || (order.deliveryDate && !validDate(order.deliveryDate))) {
        throw new Error('Dates must be valid and use YYYY-MM-DD.');
    }
    if (!groups.includes(order.sortingGroup)) throw new Error('Invalid sorting group.');
    if (!statuses.includes(order.status)) throw new Error('Invalid status.');
    return order;
}
function parseOrders(value) {
    if (!Array.isArray(value)) throw new Error('The file must contain an array of orders.');
    return value.map((item, index) => {
        try { return validateOrder(item); }
        catch (error) { throw new Error(`Order ${index + 1}: ${error.message}`); }
    });
}
function readLocalOrders() {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return [];
    const original = JSON.parse(raw);
    const result = parseOrders(original);
    if (new Set(result.map(order => order.id)).size !== result.length) throw new Error('The saved data contains duplicate order IDs.');
    if (JSON.stringify(original) !== JSON.stringify(result)) localStorage.setItem(storageKey, JSON.stringify(result));
    return result;
}
function writeLocalOrders(next) {
    localStorage.setItem(storageKey, JSON.stringify(next));
    applyOrders(next);
}
function withoutId(order) {
    const { id, ...data } = order;
    return data;
}
function sameOrder(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function captureDraft() {
    if (!editing || !editControls) return;
    const draft = Object.fromEntries(columns.map(([key]) => [key, editControls[key].value]));
    if (draft.memberName === 'Other') draft.memberName = editControls.otherName.value;
    editing.draft = draft;
}
function applyOrders(next) {
    captureDraft();
    if (editing && !busy) {
        const current = next.find(order => order.id === editing.baseline.id);
        if (!current) {
            editing = null;
            showMessage('This order was deleted elsewhere. Your unsaved edit was closed.', true);
        } else if (!sameOrder(current, editing.baseline)) {
            editing.conflict = true;
            showMessage('This order changed elsewhere. Cancel and reopen it before saving.', true);
        }
    }
    orders = next;
    renderOrders();
    updateDuplicateWarning();
}
function updateDuplicateWarning() {
    const item = $('orderedItem').value.trim().toLocaleLowerCase();
    const duplicate = item && orders.some(order => order.status === 'Pending' && order.orderedItem.trim().toLocaleLowerCase() === item);
    $('duplicateWarning').textContent = duplicate ? 'A pending order for this item already exists. You can still add another.' : '';
}
function makeSelect(options, value, label) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    select.required = true;
    for (const name of options) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.append(option);
    }
    select.value = value;
    return select;
}
function toggleOther(select, input, container) {
    const isOther = select.value === 'Other';
    container.hidden = !isOther;
    input.required = isOther;
}
function resetForm() {
    $('insertDate').value = today();
    toggleOther($('memberName'), $('otherName'), $('otherField'));
    updateDuplicateWarning();
}
function createButton(text, style, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = style;
    button.textContent = text;
    button.addEventListener('click', action);
    return button;
}
function renderOrders() {
    const body = $('tableBody');
    body.replaceChildren();
    editControls = null;
    $('emptyState').hidden = orders.length !== 0 || !readable;
    $('emptyState').textContent = mode === 'cloud' && !connected
        ? 'No cached orders are available. Connect to see the shared table.'
        : 'No orders yet. New orders will appear here.';
    $('orderCount').textContent = `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`;
    orders.forEach(order => {
        const row = document.createElement('tr');
        const isEditing = editing && order.id === editing.baseline.id;
        const values = isEditing ? editing.draft : order;
        const controls = {};
        for (const [key, label] of columns) {
            const cell = document.createElement('td');
            if (isEditing) {
                let input;
                if (key === 'memberName') {
                    input = makeSelect([...members, 'Other'], members.includes(values[key]) ? values[key] : 'Other', label);
                    const other = document.createElement('textarea');
                    other.className = 'other-input';
                    other.setAttribute('aria-label', 'Other member name');
                    other.value = members.includes(values[key]) ? '' : values[key];
                    input.addEventListener('change', () => toggleOther(input, other, other));
                    toggleOther(input, other, other);
                    controls.otherName = other;
                    cell.append(input, other);
                } else if (key === 'sortingGroup' || key === 'status') {
                    input = makeSelect(key === 'status' ? statuses : groups, values[key], label);
                    cell.append(input);
                } else {
                    const isDate = key === 'insertDate' || key === 'deliveryDate';
                    input = document.createElement(isDate || key === 'quantity' ? 'input' : 'textarea');
                    if (isDate) input.type = 'date';
                    if (key === 'quantity') { input.type = 'number'; input.min = '1'; input.step = '1'; }
                    input.value = values[key];
                    input.required = !optional.has(key) || key === 'quantity';
                    input.setAttribute('aria-label', label);
                    cell.append(input);
                }
                controls[key] = input;
            } else if (key === 'status') {
                const badge = document.createElement('span');
                badge.className = `badge badge-${order[key].toLowerCase()}`;
                badge.textContent = order[key];
                cell.append(badge);
            } else {
                cell.textContent = order[key] === '' ? '—' : String(order[key]);
            }
            row.append(cell);
        }
        const actions = document.createElement('td');
        const actionGroup = document.createElement('div');
        actionGroup.className = 'row-actions';
        if (isEditing) {
            editControls = controls;
            const save = createButton('Save', 'primary', async () => {
                captureDraft();
                try {
                    const updated = validateOrder({ ...editing.draft, id: editing.baseline.id });
                    if (await commit('edit', [updated], editing.baseline)) {
                        editing = null;
                        renderOrders();
                        showMessage('Order updated.');
                    }
                } catch (error) { showMessage(error.message, true); }
            });
            save.dataset.conflict = String(editing.conflict);
            const cancel = createButton('Cancel', 'secondary', () => { editing = null; renderOrders(); });
            cancel.dataset.action = 'cancel';
            actionGroup.append(save, cancel);
        } else {
            const edit = createButton('Edit', 'secondary', () => {
                captureDraft();
                editing = { baseline: order, draft: { ...order }, conflict: false };
                renderOrders();
            });
            const remove = createButton('Delete', 'danger', async () => {
                if (!confirm('Delete this order?')) return;
                if (await commit('delete', [], order)) showMessage('Order deleted.');
            });
            edit.dataset.action = remove.dataset.action = 'other';
            actionGroup.append(edit, remove);
        }
        actions.append(actionGroup);
        row.append(actions);
        body.append(row);
    });
    updateControls();
}
async function commit(kind, incoming, baseline = null) {
    if (!connected || busy) {
        showMessage('Changes are unavailable while the app is disconnected or another save is in progress.', true);
        return null;
    }
    busy = true;
    updateControls();
    try {
        if (kind === 'import' && incoming.length > 400) throw new Error('Import at most 400 orders at a time.');
        let result;
        if (mode === 'local') {
            const current = readLocalOrders();
            if (baseline) {
                const existing = current.find(order => order.id === baseline.id);
                if (!existing || !sameOrder(existing, baseline)) throw new Error('This order changed elsewhere. Cancel and reopen it.');
            }
            if (kind === 'delete') {
                writeLocalOrders(current.filter(order => order.id !== baseline.id));
                result = { added: 0, skipped: 0 };
            } else if (kind === 'edit') {
                writeLocalOrders(current.map(order => order.id === baseline.id ? incoming[0] : order));
                result = { added: 0, skipped: 0 };
            } else {
                const ids = new Set(current.map(order => order.id));
                const added = incoming.filter(order => {
                    if (ids.has(order.id)) return false;
                    ids.add(order.id);
                    return true;
                });
                if (kind === 'add' && added.length !== 1) throw new Error('Order ID already exists. Please try again.');
                writeLocalOrders(kind === 'add' ? [...added, ...current] : [...current, ...added]);
                result = { added: added.length, skipped: incoming.length - added.length };
            }
        } else if (baseline) {
            const current = orders.find(order => order.id === baseline.id);
            if (!current || !sameOrder(current, baseline)) throw new Error('This order changed elsewhere. Cancel and reopen it.');
            const orderRef = realtime.ref(database, `orders/${baseline.id}`);
            if (kind === 'delete') await realtime.remove(orderRef);
            else await realtime.update(orderRef, withoutId(incoming[0]));
            result = { added: 0, skipped: 0 };
        } else if (kind === 'add') {
            await realtime.push(ordersRef, withoutId(incoming[0]));
            result = { added: 1, skipped: 0 };
        } else if (incoming.length === 0) {
            result = { added: 0, skipped: 0 };
        } else {
            const seen = new Set();
            const unique = incoming.filter(order => {
                if (seen.has(order.id)) return false;
                seen.add(order.id);
                return true;
            });
            let added = 0;
            const transaction = await realtime.runTransaction(ordersRef, current => {
                if (current !== null && typeof current !== 'object') throw new Error('The orders database is not a collection.');
                const next = { ...current };
                added = 0;
                for (const order of unique) {
                    if (!Object.prototype.hasOwnProperty.call(next, order.id)) {
                        next[order.id] = withoutId(order);
                        added++;
                    }
                }
                return next;
            }, { applyLocally: false });
            if (!transaction.committed) throw new Error('The import transaction was not committed.');
            result = { added, skipped: incoming.length - added };
        }
        return result;
    } catch (error) {
        showMessage(`Could not save changes: ${error.message}`, true);
        return null;
    } finally {
        busy = false;
        updateControls();
    }
}
function csvField(value) {
    value = String(value);
    const safe = /^[=+\-@]/.test(value) ? '\t' + value : value;
    return `"${safe.replace(/"/g, '""')}"`;
}
function toCsv() {
    const rows = [
        ['Order ID', ...columns.map(([, label]) => label)],
        ...orders.map(order => [order.id, ...columns.map(([key]) => order[key])])
    ];
    return rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
function parseCsv(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false, closedQuote = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (char === '"') { quoted = false; closedQuote = true; }
            else field += char;
        } else if (char === '"') {
            if (field || closedQuote) throw new Error('Invalid quote in CSV.');
            quoted = true;
        } else if (char === ',' || char === '\n' || char === '\r') {
            row.push(field); field = ''; closedQuote = false;
            if (char !== ',') {
                rows.push(row); row = [];
                if (char === '\r' && text[i + 1] === '\n') i++;
            }
        } else {
            if (closedQuote) throw new Error('Unexpected text after a quoted CSV field.');
            field += char;
        }
    }
    if (quoted) throw new Error('Unclosed quoted CSV field.');
    if (row.length || field || closedQuote) { row.push(field); rows.push(row); }
    if (!rows.length) throw new Error('The CSV file is empty.');
    const header = rows.shift();
    const indexes = columns.map(([key, label]) => {
        const matches = header.reduce((found, value, index) => {
            if (value.trim() === label || value.trim() === key) found.push(index);
            return found;
        }, []);
        if (matches.length > 1 || (matches.length === 0 && !optional.has(key))) {
            throw new Error(`CSV must have exactly one "${label}" column.`);
        }
        return matches.length ? matches[0] : -1;
    });
    const idIndexes = header.map((value, index) => value.trim() === 'Order ID' || value.trim() === 'id' ? index : -1).filter(index => index >= 0);
    if (idIndexes.length > 1) throw new Error('CSV contains multiple order ID columns.');
    return rows.filter(values => values.some(value => value.trim() !== '')).map((values, index) => {
        if (values.length !== header.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns.`);
        const result = Object.fromEntries(columns.map(([key], position) => [key, indexes[position] < 0 ? undefined : values[indexes[position]]]));
        if (idIndexes.length && values[idIndexes[0]].trim()) result.id = values[idIndexes[0]].trim();
        return result;
    });
}
function download(content, type, filename) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function startStorage() {
    const configured = Object.values(firebaseConfig).some(value => typeof value === 'string' && value.trim());
    if (!configured) {
        mode = 'local';
        setStatus('Local Mode');
        $('storageNotice').textContent = 'Orders are saved only in this browser and are not shared. Export a backup before clearing browser data or switching devices.';
        try {
            const local = readLocalOrders();
            connected = readable = true;
            applyOrders(local);
        } catch (error) {
            showMessage(`Cannot read saved orders: ${error.message} Existing data was not changed.`, true);
            renderOrders();
        }
        return;
    }
    mode = 'cloud';
    setStatus('Connecting...');
    $('storageNotice').textContent = 'Orders use a shared database without login. If database rules allow public access, anyone can read, change, or delete them.';
    try {
        try {
            $('exportLocal').hidden = localStorage.getItem(storageKey) === null;
        } catch (error) {
            showMessage(`Cannot access the local backup: ${error.message}`, true);
        }
        if (!firebaseConfig.apiKey || !firebaseConfig.databaseURL || !firebaseConfig.projectId || !firebaseConfig.appId) {
            throw new Error('Firebase configuration is incomplete. Fill in apiKey, databaseURL, projectId, and appId.');
        }
        const firebase = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
        realtime = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js');
        database = realtime.getDatabase(firebase.initializeApp(firebaseConfig));
        ordersRef = realtime.ref(database, 'orders');
        const syncFailed = error => {
            cloudError = true;
            updateCloudStatus();
            showMessage(`Cloud sync failed: ${error.message}. Orders were not switched to local mode. Check Realtime Database rules and reload to retry.`, true);
        };
        realtime.onValue(realtime.ref(database, '.info/connected'), snapshot => {
            cloudConnected = snapshot.val() === true;
            updateCloudStatus();
        }, syncFailed);
        realtime.onValue(ordersRef, snapshot => {
            try {
                const next = [];
                snapshot.forEach(child => {
                    next.push(validateOrder({ ...child.val(), id: child.key }));
                });
                next.sort((a, b) => b.insertDate.localeCompare(a.insertDate) || a.id.localeCompare(b.id));
                readable = true;
                cloudReady = true;
                updateCloudStatus();
                applyOrders(next);
            } catch (error) {
                cloudReady = false;
                updateCloudStatus();
                showMessage(`Cannot display cloud orders: ${error.message}`, true);
            }
        }, syncFailed);
    } catch (error) {
        connected = false;
        setStatus('Sync Error');
        showMessage(`Cloud setup failed: ${error.message}. Orders were not switched to local mode.`, true);
        updateControls();
    }
}

const memberSelect = makeSelect(['', ...members, 'Other'], '', 'Lab member name');
memberSelect.firstElementChild.textContent = 'Select a lab member';
$('memberName').replaceChildren(...memberSelect.childNodes);
$('memberName').value = '';
$('memberName').addEventListener('change', () => toggleOther($('memberName'), $('otherName'), $('otherField')));
$('orderedItem').addEventListener('input', updateDuplicateWarning);
$('orderForm').addEventListener('reset', () => { setTimeout(resetForm, 0); });
$('orderForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (editing) {
        showMessage('Finish or cancel the current edit before adding an order.', true);
        return;
    }
    try {
        const data = Object.fromEntries(columns.map(([key]) => [key, $(key).value]));
        if (data.memberName === 'Other') data.memberName = $('otherName').value;
        const result = await commit('add', [validateOrder(data)]);
        if (result) {
            $('orderForm').reset();
            editing = null;
            renderOrders();
            showMessage('Order added.');
        }
    } catch (error) { showMessage(error.message, true); }
});
$('exportCsv').addEventListener('click', () => download('\uFEFF' + toCsv(), 'text/csv;charset=utf-8', 'equipment-orders.csv'));
$('exportJson').addEventListener('click', () => download(JSON.stringify(orders, null, 2), 'application/json;charset=utf-8', 'equipment-orders.json'));
$('exportLocal').addEventListener('click', () => {
    try {
        download(JSON.stringify(readLocalOrders(), null, 2), 'application/json;charset=utf-8', 'local-equipment-orders.json');
    } catch (error) { showMessage(`Cannot export the local backup: ${error.message}`, true); }
});
$('importButton').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const extension = file.name.split('.').pop().toLowerCase();
        if (!['csv', 'json'].includes(extension)) throw new Error('Choose a CSV or JSON file.');
        const imported = parseOrders(extension === 'csv' ? parseCsv(text) : JSON.parse(text.replace(/^\uFEFF/, '')));
        const result = await commit('import', imported);
        if (result) {
            editing = null;
            renderOrders();
            showMessage(`Imported ${result.added} orders; skipped ${result.skipped} existing IDs.`);
        }
    } catch (error) { showMessage(`Import failed: ${error.message} No orders were changed.`, true); }
    finally { event.target.value = ''; }
});
window.addEventListener('storage', event => {
    if (mode === 'local' && (event.key === storageKey || event.key === null)) {
        try {
            const local = readLocalOrders();
            connected = readable = true;
            applyOrders(local);
        } catch (error) {
            connected = readable = false;
            showMessage(`Cannot read saved orders: ${error.message} Existing data was not changed.`, true);
            renderOrders();
        }
    }
});
resetForm();
startStorage();
