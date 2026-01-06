// public/js/companies.js

let allCompanies = [];
let filteredCompanies = [];
let companyPage = 1;
const companyPageSize = 10;
let companyModal = null;

document.addEventListener("DOMContentLoaded", () => {
  const modalEl = document.getElementById("companyModal");
  if (!modalEl) {
    console.warn("[companies.js] #companyModal not found (skipping modal init).");
    return;
  }

  companyModal = bootstrap.Modal.getOrCreateInstance(modalEl);

  const codeSearch = document.getElementById("searchCompanyCode");
  const nameSearch = document.getElementById("searchCompanyName");

  if (codeSearch) codeSearch.addEventListener("input", applyCompanyFilters);
  if (nameSearch) nameSearch.addEventListener("input", applyCompanyFilters);

  loadCompanies();
});


// =================== LOAD COMPANIES ===================
function loadCompanies() {
  fetch("/api/companies")
    .then(res => res.json())
    .then(companies => {
      allCompanies = companies;
      filteredCompanies = [];
      companyPage = 1;
      renderCompanyTable();
    })
    .catch(err => console.error("loadCompanies error:", err));
}

function getCompanyData() {
  return filteredCompanies.length ? filteredCompanies : allCompanies;
}

// =================== FILTER ===================
function applyCompanyFilters() {
  const codeVal = document.getElementById("searchCompanyCode").value.toLowerCase().trim();
  const nameVal = document.getElementById("searchCompanyName").value.toLowerCase().trim();

  filteredCompanies = allCompanies.filter(c => {
    const code = (c.short_code || "").toLowerCase();
    const name = (c.name || "").toLowerCase();

    return (!codeVal || code.includes(codeVal)) &&
           (!nameVal || name.includes(nameVal));
  });

  companyPage = 1;
  renderCompanyTable();
}

// =================== RENDER TABLE ===================
function renderCompanyTable() {
  const tbody = document.getElementById("companiesBody");
  const data = getCompanyData();
  const total = data.length;

  const totalPages = Math.max(1, Math.ceil(total / companyPageSize));
  companyPage = Math.min(companyPage, totalPages);

  const start = (companyPage - 1) * companyPageSize;
  const pageItems = data.slice(start, start + companyPageSize);

  tbody.innerHTML = "";

  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-muted py-4">No companies found.</td>
      </tr>`;
  } else {
    pageItems.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.short_code || "-"}</td>
        <td>${c.name}</td>
        <td>${c.address || "-"}</td>
        <td>${c.phone || "-"}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-2" onclick="openEditCompany(${c.id})">Edit</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteCompany(${c.id})">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  const end = start + pageItems.length;
  const text = total ? `Showing ${start + 1}-${end} of ${total} companies` : "No companies";

  document.getElementById("companiesCountTop").textContent = text;
  document.getElementById("companiesCountBottom").textContent = text;

  renderCompanyPagination(totalPages);
}

// =================== PAGINATION ===================
function renderCompanyPagination(totalPages) {
  renderCompanyPaginationSingle("companiesPaginationTop", totalPages);
  renderCompanyPaginationSingle("companiesPaginationBottom", totalPages);
}

function renderCompanyPaginationSingle(id, totalPages) {
  const ul = document.getElementById(id);
  ul.innerHTML = "";

  if (totalPages <= 1) {
    ul.style.display = "none";
    return;
  }

  ul.style.display = "flex";

  const windowSize = 5;
  let start = companyPage - Math.floor(windowSize / 2);
  let end = companyPage + Math.floor(windowSize / 2);

  if (start < 1) { end += 1 - start; start = 1; }
  if (end > totalPages) { start -= end - totalPages; end = totalPages; }

  // Prev
  const prev = document.createElement("li");
  prev.className = "page-item" + (companyPage === 1 ? " disabled" : "");
  prev.innerHTML = `<button class="page-link">&lt;</button>`;
  prev.onclick = () => { companyPage--; renderCompanyTable(); };
  ul.appendChild(prev);

  // Page numbers
  for (let i = start; i <= end; i++) {
    const li = document.createElement("li");
    li.className = "page-item" + (i === companyPage ? " active" : "");
    li.innerHTML = `<button class="page-link">${i}</button>`;
    li.onclick = () => { companyPage = i; renderCompanyTable(); };
    ul.appendChild(li);
  }

  // Next
  const next = document.createElement("li");
  next.className = "page-item" + (companyPage === totalPages ? " disabled" : "");
  next.innerHTML = `<button class="page-link">&gt;</button>`;
  next.onclick = () => { companyPage++; renderCompanyTable(); };
  ul.appendChild(next);
}

// =================== MODAL FUNCTIONS ===================
async function loadCompanyRulesIntoModal(companyId) {
  const box = document.getElementById("companyRulesBox");
  if (!box) return;

  box.innerHTML = `<div class="text-muted small">Loading rules...</div>`;

  try {
    const res = await fetch(`/api/companies/${companyId}/rules`);
    if (!res.ok) {
      box.innerHTML = `<div class="text-danger small">Failed to load rules (HTTP ${res.status}).</div>`;
      return;
    }

    const rules = await res.json();

    if (!Array.isArray(rules)) {
      box.innerHTML = `<div class="text-danger small">Rules API returned invalid data.</div>`;
      return;
    }

    box.innerHTML = rules.map(r => {
      const disabled = r.is_default ? "disabled" : "";
      const checked = (r.enabled || r.is_default) ? "checked" : "";
      return `
        <div class="form-check mb-2">
          <input class="form-check-input company-rule"
                 type="checkbox"
                 data-rule="${r.code}"
                 id="rule_${r.code}"
                 ${checked} ${disabled}>
          <label class="form-check-label" for="rule_${r.code}">
            <div class="fw-medium">${r.name}</div>
            ${r.description ? `<div class="text-muted small">${r.description}</div>` : ""}
          </label>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("loadCompanyRulesIntoModal error:", err);
    box.innerHTML = `<div class="text-danger small">Error loading rules.</div>`;
  }
}

window.openEditCompany = function (id) {
  const companyId = Number(id);
  const c = allCompanies.find(x => Number(x.id) === companyId);
  if (!c) return;

  const idEl = document.getElementById("companyId");
  const nameEl = document.getElementById("companyName");
  const codeEl = document.getElementById("companyShortCode");
  const addrEl = document.getElementById("companyAddress");
  const phoneEl = document.getElementById("companyPhone");

  if (!idEl || !nameEl || !codeEl || !addrEl || !phoneEl) {
    alert("Company modal form elements not found. Check your HTML IDs.");
    return;
  }

  idEl.value = c.id;
  nameEl.value = c.name || "";
  codeEl.value = c.short_code || "";
  addrEl.value = c.address || "";
  phoneEl.value = c.phone || "";

  if (!companyModal) {
    const modalEl = document.getElementById("companyModal");
    if (!modalEl) {
      alert("companyModal not found in HTML.");
      return;
    }
    companyModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  }

  // Open modal immediately, then load rules async
  companyModal.show();
  loadCompanyRulesIntoModal(companyId);
};



window.openCreateCompany = function () {
  document.getElementById("companyForm").reset();
  document.getElementById("companyId").value = "";

  const box = document.getElementById("companyRulesBox");
  if (box) {
    box.innerHTML = `<div class="text-muted small">Save company first, then edit rules.</div>`;
  }

  companyModal.show();
};




window.saveCompany = async function () {
  if (!companyModal) {
    const modalEl = document.getElementById("companyModal");
    if (!modalEl) {
      alert("companyModal not found in HTML.");
      return;
    }
    companyModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  }

  const idRaw = (document.getElementById("companyId")?.value || "").trim();

  const name = (document.getElementById("companyName")?.value || "").trim();
  const short_code = (document.getElementById("companyShortCode")?.value || "").trim();
  const address = (document.getElementById("companyAddress")?.value || "").trim();
  const phone = (document.getElementById("companyPhone")?.value || "").trim();

  if (!name) {
    alert("Company name is required.");
    return;
  }
  if (!short_code) {
    alert("Company short code is required.");
    return;
  }

  const payload = { name, short_code, address, phone };

  const isEdit = !!idRaw;
  const method = isEdit ? "PUT" : "POST";
  const url = isEdit ? `/api/companies/${encodeURIComponent(idRaw)}` : "/api/companies";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      // backend may return empty body or HTML on error
    }

    if (!res.ok) {
      alert(data?.error || `Error saving company (HTTP ${res.status}).`);
      return;
    }

    const savedCompanyId = isEdit ? Number(idRaw) : Number(data?.id);
    if (!Number.isFinite(savedCompanyId) || savedCompanyId <= 0) {
      alert("Saved company but missing company id in response.");
      return;
    }

    // Save rules if the rules box exists (create mode might show 'save first')
    const hasRulesUI = document.querySelectorAll(".company-rule").length > 0;
    if (hasRulesUI) {
      await saveCompanyRules(savedCompanyId);
    }

    companyModal.hide();
    loadCompanies();

    if (typeof window.refreshCompanyDropdown === "function") {
      window.refreshCompanyDropdown(savedCompanyId);
    }
  } catch (err) {
    console.error("saveCompany error:", err);
    alert("Network/server error while saving company.");
  }
};



async function saveCompanyRules(companyId) {
  const selected = Array.from(document.querySelectorAll(".company-rule:checked"))
    .map(cb => cb.dataset.rule);

  // base rule always on (safety)
  if (!selected.includes("BASE_NATIONALITY")) selected.push("BASE_NATIONALITY");

  await fetch(`/api/companies/${companyId}/rules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: selected })
  });
}

window.deleteCompany = function (id) {
  if (!confirm("Delete this company?")) return;

  fetch(`/api/companies/${id}`, { method: "DELETE" })
    .then(res => res.json())
    .then(() => {
      loadCompanies();

      // 🔹 refresh navbar dropdown as well
      if (typeof window.refreshCompanyDropdown === "function") {
        window.refreshCompanyDropdown();
      }
    })
    .catch(err => {
      console.error("deleteCompany error:", err);
      alert("Error deleting company.");
    });
};
