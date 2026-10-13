
"use strict";

const DEFAULT_CATEGORIES = [
  "Logement", "Alimentation", "Transport", "Santé",
  "Loisirs", "Factures", "Shopping", "Éducation",
  "Salaire", "Autres"
];

const COLORS = [
  "#8a63ff", "#39d6a0", "#ffad55", "#ff6389",
  "#4fc8e8", "#648cff", "#b19aff", "#f0cf62"
];

const KEYS = {
  transactions: "budgetflow_transactions_v2",
  categories: "budgetflow_categories_v2"
};

const $ = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR"
});

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

let transactions = readStorage(KEYS.transactions, []);
let categories = readStorage(KEYS.categories, [...DEFAULT_CATEGORIES]);
let toastTimer;

if (!Array.isArray(transactions)) transactions = [];
if (!Array.isArray(categories)) categories = [...DEFAULT_CATEGORIES];

transactions = transactions.filter(t =>
  t && typeof t.id === "string" &&
  typeof t.description === "string" &&
  Number.isFinite(Number(t.amount)) &&
  Number(t.amount) > 0 &&
  ["income", "expense"].includes(t.type) &&
  /^\d{4}-\d{2}-\d{2}$/.test(t.date)
);

categories = [...new Set(
  categories.filter(c => typeof c === "string")
    .map(c => c.trim()).filter(Boolean)
)];

if (!categories.length) categories = [...DEFAULT_CATEGORIES];

function saveData() {
  try {
    localStorage.setItem(KEYS.transactions, JSON.stringify(transactions));
    localStorage.setItem(KEYS.categories, JSON.stringify(categories));
  } catch {
    toast("La sauvegarde a échoué. Vérifie l'espace disponible.");
  }
}

function money(value) {
  return currency.format(Number(value) || 0);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[char]);
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateLabel(value) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR");
}

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function currentYear() {
  return Number($("yearSelect").value) || new Date().getFullYear();
}

function yearItems() {
  const year = String(currentYear());
  return transactions.filter(t => t.date.startsWith(year));
}

function totals(items) {
  return items.reduce((result, t) => {
    result[t.type] += Number(t.amount);
    return result;
  }, { income: 0, expense: 0 });
}

function renderYears() {
  const select = $("yearSelect");
  const old = Number(select.value) || new Date().getFullYear();
  const years = new Set([new Date().getFullYear(), old]);

  transactions.forEach(t => years.add(Number(t.date.slice(0, 4))));

  select.innerHTML = [...years].filter(Number.isInteger)
    .sort((a, b) => b - a)
    .map(y => `<option value="${y}">${y}</option>`).join("");

  select.value = String(old);
  $("chartYearLabel").textContent = String(old);
  $("annualYearLabel").textContent = String(old);
}

function renderCategoryOptions() {
  const select = $("category");
  const old = select.value;

  select.innerHTML = categories.map(c =>
    `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`
  ).join("");

  if (categories.includes(old)) select.value = old;
}

function renderCategoryManager() {
  $("categoryList").innerHTML = categories.map(c => `
    <span class="category-chip">
      ${escapeHTML(c)}
      <button type="button" class="remove-category"
        data-remove-category="${escapeHTML(c)}"
        aria-label="Supprimer ${escapeHTML(c)}">×</button>
    </span>
  `).join("");
}

function renderSummary(items) {
  const sum = totals(items);
  const balance = sum.income - sum.expense;
  const rate = sum.income > 0 ? balance / sum.income * 100 : null;

  $("incomeTotal").textContent = money(sum.income);
  $("expenseTotal").textContent = money(sum.expense);
  $("balanceTotal").textContent = money(balance);
  $("balanceTotal").style.color = balance < 0
    ? "var(--red)" : "var(--green)";

  $("savingsRate").textContent = rate === null
    ? "—"
    : `${rate.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;

  $("savingsRate").style.color = rate !== null && rate < 0
    ? "var(--red)" : "var(--purple-light)";
}

function renderTransactions(items) {
  const query = $("searchInput").value.trim().toLocaleLowerCase("fr");
  const type = $("typeFilter").value;

  const filtered = [...items]
    .filter(t => type === "all" || t.type === type)
    .filter(t =>
      `${t.description} ${t.category}`.toLocaleLowerCase("fr").includes(query)
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  $("transactionCount").textContent =
    `${filtered.length} transaction${filtered.length > 1 ? "s" : ""}`;

  $("emptyTransactions").classList.toggle("hidden", filtered.length > 0);

  $("transactionList").innerHTML = filtered.map(t => {
    const income = t.type === "income";
    const amount = `${income ? "+" : "−"}${money(t.amount)}`;

    return `
      <tr>
        <td>${dateLabel(t.date)}</td>
        <td>
          <div class="transaction-description">
            <span class="transaction-badge">${income ? "↙" : "↗"}</span>
            <span class="transaction-name">${escapeHTML(t.description)}</span>
          </div>
        </td>
        <td>${escapeHTML(t.category)}</td>
        <td class="${income ? "amount-income" : "amount-expense"}">${amount}</td>
        <td><span class="type-badge ${t.type}">${income ? "Revenu" : "Dépense"}</span></td>
        <td>
          <div class="row-actions">
            <button type="button" class="icon-button" data-edit="${escapeHTML(t.id)}" title="Modifier">✎</button>
            <button type="button" class="icon-button delete-button" data-delete="${escapeHTML(t.id)}" title="Supprimer">×</button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

function renderCategoryBreakdown(items) {
  const expenses = items.filter(t => t.type === "expense");
  const total = expenses.reduce((sum, t) => sum + Number(t.amount), 0);

  $("categoryExpenseTotal").textContent = money(total);

  const stats = categories.map((category, index) => {
    const amount = expenses
      .filter(t => t.category === category)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return {
      category,
      amount,
      percent: total ? amount / total * 100 : 0,
      color: COLORS[index % COLORS.length]
    };
  }).sort((a, b) => b.amount - a.amount);

  $("categoryBreakdown").innerHTML = stats.map(s => `
    <div class="breakdown-row">
      <div class="breakdown-name">
        <i class="category-dot" style="background:${s.color}"></i>
        <span>${escapeHTML(s.category)}</span>
      </div>
      <div class="breakdown-track">
        <div class="breakdown-bar" style="width:${s.percent}%;background:${s.color}"></div>
      </div>
      <div class="breakdown-amount">
        ${money(s.amount)}
        <span class="breakdown-percent">${s.percent.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</span>
      </div>
    </div>
  `).join("");
}

function renderAnnual(items) {
  const expenses = items.filter(t => t.type === "expense");
  const total = expenses.reduce((sum, t) => sum + Number(t.amount), 0);

  const rows = categories.map(c => {
    const matching = expenses.filter(t => t.category === c);
    const amount = matching.reduce((sum, t) => sum + Number(t.amount), 0);
    return {
      category: c,
      count: matching.length,
      amount,
      percent: total ? amount / total * 100 : 0
    };
  }).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "fr"));

  $("annualCategoryBody").innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHTML(r.category)}</td>
      <td>${r.count}</td>
      <td class="${r.amount === 0 ? "zero-value" : ""}">${money(r.amount)}</td>
      <td>
        <div class="share-number">${r.percent.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</div>
        <div class="progress-track">
          <div class="progress-bar" style="width:${r.percent}%"></div>
        </div>
      </td>
    </tr>
  `).join("");

  $("annualTransactionCount").textContent = expenses.length;
  $("annualCategoryTotal").textContent = money(total);
  $("annualShareTotal").textContent = total > 0 ? "100 %" : "0 %";
}

/* Graphique dessiné sans bibliothèque externe. */
function drawChart() {
  const canvas = $("monthlyChart");
  const box = canvas.parentElement;
  const width = Math.max(280, box.clientWidth);
  const height = Math.max(180, box.clientHeight);
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const css = getComputedStyle(document.body);
  const muted = css.getPropertyValue("--muted").trim();
  const border = css.getPropertyValue("--border").trim();
  const green = css.getPropertyValue("--green").trim();
  const purple = css.getPropertyValue("--purple").trim();

  const monthly = Array.from({ length: 12 }, () => ({
    income: 0, expense: 0
  }));

  yearItems().forEach(t => {
    const index = Number(t.date.slice(5, 7)) - 1;
    if (index >= 0 && index < 12) {
      monthly[index][t.type] += Number(t.amount);
    }
  });

  const labels = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
    "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];

  const max = Math.max(1, ...monthly.flatMap(m => [m.income, m.expense]));
  const pad = { left: 58, right: 15, top: 18, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = i => pad.left + plotW * i / 11;
  const y = v => pad.top + plotH - plotH * v / max;

  ctx.font = "10px Segoe UI, Arial";
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4;
    const py = y(v);
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(pad.left, py);
    ctx.lineTo(width - pad.right, py);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.fillText(v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }), pad.left - 8, py);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = muted;
  labels.forEach((label, i) => ctx.fillText(label, x(i), height - pad.bottom + 10));

  function line(key, color) {
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;

    monthly.forEach((m, i) => {
      if (i === 0) ctx.moveTo(x(i), y(m[key]));
      else ctx.lineTo(x(i), y(m[key]));
    });
    ctx.stroke();

    monthly.forEach((m, i) => {
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(x(i), y(m[key]), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  line("income", green);
  line("expense", purple);

  canvas.onmousemove = event => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    let nearest = null;

    monthly.forEach((m, i) => {
      ["income", "expense"].forEach(type => {
        const distance = Math.hypot(x(i) - mx, y(m[type]) - my);
        if (distance < 15 && (!nearest || distance < nearest.distance)) {
          nearest = { distance, i, type, amount: m[type] };
        }
      });
    });

    canvas.title = nearest
      ? `${labels[nearest.i]} — ${nearest.type === "income" ? "Revenus" : "Dépenses"} : ${money(nearest.amount)}`
      : "Revenus et dépenses par mois";
  };
}

function renderAll() {
  renderYears();
  renderCategoryOptions();
  renderCategoryManager();

  const items = yearItems();
  renderSummary(items);
  renderTransactions(items);
  renderCategoryBreakdown(items);
  renderAnnual(items);
  drawChart();
}

function resetForm() {
  $("transactionForm").reset();
  $("transactionId").value = "";
  $("date").value = localDate();
  $("formTitle").textContent = "Nouvelle transaction";
  $("saveTransaction").textContent = "＋ Ajouter la transaction";
  $("cancelEdit").classList.add("hidden");
  const expenseRadio = document.querySelector('input[name="type"][value="expense"]');
  if (expenseRadio) expenseRadio.checked = true;
}

function editTransaction(id) {
  const t = transactions.find(item => item.id === id);
  if (!t) return;

  if (!categories.includes(t.category)) categories.push(t.category);

  renderCategoryOptions();
  $("transactionId").value = t.id;
  $("description").value = t.description;
  $("amount").value = t.amount;
  $("category").value = t.category;
  $("date").value = t.date;

  const radio = document.querySelector(`input[name="type"][value="${t.type}"]`);
  if (radio) radio.checked = true;

  $("formTitle").textContent = "Modifier la transaction";
  $("saveTransaction").textContent = "Enregistrer les modifications";
  $("cancelEdit").classList.remove("hidden");

  $("transactionForm").scrollIntoView({ behavior: "smooth", block: "center" });
}

$("transactionForm").addEventListener("submit", event => {
  event.preventDefault();

  const id = $("transactionId").value;
  const description = $("description").value.trim();
  const amount = Number($("amount").value);
  const type = document.querySelector('input[name="type"]:checked')?.value;
  const category = $("category").value;
  const date = $("date").value;

  if (!description || !Number.isFinite(amount) || amount <= 0 ||
      !categories.includes(category) ||
      !["income", "expense"].includes(type) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    toast("Vérifie les informations saisies.");
    return;
  }

  const record = { id: id || newId(), description, amount, type, category, date };

  if (id) {
    const index = transactions.findIndex(t => t.id === id);
    if (index >= 0) transactions[index] = record;
    toast("Transaction modifiée.");
  } else {
    transactions.push(record);
    toast("Transaction ajoutée.");
  }

  saveData();
  resetForm();
  renderAll();
});

$("cancelEdit").addEventListener("click", resetForm);

$("categoryForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("newCategory");
  const name = input.value.trim();
  if (!name) return;

  if (categories.some(c => c.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"))) {
    toast("Cette catégorie existe déjà.");
    return;
  }

  categories.push(name);
  saveData();
  input.value = "";
  renderAll();
  $("category").value = name;
  toast("Catégorie ajoutée.");
});

$("categoryList").addEventListener("click", event => {
  const button = event.target.closest("[data-remove-category]");
  if (!button) return;

  const name = button.dataset.removeCategory;

  if (transactions.some(t => t.category === name)) {
    toast("Cette catégorie est utilisée. Modifie ou supprime ses transactions d'abord.");
    return;
  }
  if (categories.length <= 1) {
    toast("Garde au moins une catégorie.");
    return;
  }

  categories = categories.filter(c => c !== name);
  saveData();
  renderAll();
  toast("Catégorie supprimée.");
});

$("transactionList").addEventListener("click", event => {
  const edit = event.target.closest("[data-edit]");
  const remove = event.target.closest("[data-delete]");

  if (edit) {
    editTransaction(edit.dataset.edit);
    return;
  }

  if (remove) {
    const id = remove.dataset.delete;
    const item = transactions.find(t => t.id === id);
    if (!item) return;

    if (!confirm(`Supprimer la transaction « ${item.description} » ?`)) return;

    transactions = transactions.filter(t => t.id !== id);
    saveData();
    renderAll();
    toast("Transaction supprimée.");
  }
});

$("yearSelect").addEventListener("change", renderAll);
$("searchInput").addEventListener("input", () => renderTransactions(yearItems()));
$("typeFilter").addEventListener("change", () => renderTransactions(yearItems()));

$("exportCsv").addEventListener("click", () => {
  const items = yearItems().sort((a, b) => a.date.localeCompare(b.date));

  if (!items.length) {
    toast("Aucune transaction à exporter pour cette année.");
    return;
  }

  const cell = value => `"${String(value).replace(/"/g, '""')}"`;
  const rows = [
    ["Date", "Description", "Type", "Catégorie", "Montant (€)"],
    ...items.map(t => [
      t.date,
      t.description,
      t.type === "income" ? "Revenu" : "Dépense",
      t.category,
      Number(t.amount).toFixed(2).replace(".", ",")
    ])
  ];

  const csv = "\uFEFF" + rows.map(row => row.map(cell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = `BudgetFlow-${currentYear()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  toast("Export CSV téléchargé.");
});

document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach(item => item.classList.remove("active"));
    link.classList.add("active");
  });
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawChart, 120);
});

$("date").value = localDate();
renderAll();
