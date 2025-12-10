/*************************************************
 * CONFIG GERAL + LOGIN
 *************************************************/

// Base da API: local (dev) x produção (Render)
const API_BASE = 'https://aircontrolos-api.onrender.com';

// CARGOS padronizados (iguais ao backend)
const CARGOS = ["Admin", "Tecnico", "Ajudante", "MeioOficial", "Mecanico"];

/************* LOGIN *************/
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const senha = document.getElementById("loginSenha").value.trim();

    if (!email || !senha) {
      alert("Preencha e-mail e senha.");
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha })
      });

      if (!res.ok) {
        if (res.status === 403) {
          const txt = await res.text().catch(() => "");
          alert(txt || "Período de testes encerrado. Entre em contato para liberar o acesso.");
        } else if (res.status === 401) {
          alert("E-mail ou senha inválidos.");
        } else {
          alert("Falha ao fazer login. Código: " + res.status);
        }
        return;
      }

      const user = await res.json();

      // 🔹 Normaliza o cargo vindo do backend
      const cargoBack = user.cargo || user.Cargo || "";
      let cargoNorm = cargoBack.toString().trim().toLowerCase(); // "admin", "tecnico", "administrador", etc.

      // se vier "administrador", padroniza pra "admin"
      if (cargoNorm === "administrador") {
        cargoNorm = "admin";
      }

      user.cargo = cargoNorm; // garante que o objeto também fique padronizado

      console.log("Login OK. Usuário:", user.email, "Cargo normalizado:", cargoNorm);

      // sessão atual
      sessionStorage.setItem("air_user", JSON.stringify(user));
      sessionStorage.setItem("cargo", cargoNorm);

      // também no localStorage (PWA / rotas)
      localStorage.setItem("air_user", JSON.stringify(user));
      localStorage.setItem("userRole", cargoNorm);

      window.location.href = "dashboard.html";

    } catch (err) {
      console.error(err);
      alert("Falha de conexão com o servidor.");
    }
  });
}

/************* TOPO + LOGOUT + BADGE *************/
function logout() {
  sessionStorage.removeItem("air_user");
  sessionStorage.removeItem("cargo");
  localStorage.removeItem("air_user");
  localStorage.removeItem("userRole");
  window.location.href = "index.html";
}

(function showUser() {
  const badge = document.getElementById("userBadge");
  if (!badge) return;
  try {
    const user =
      JSON.parse(sessionStorage.getItem("air_user") || "null") ||
      JSON.parse(localStorage.getItem("air_user") || "null");
    badge.textContent = user && user.email ? user.email : "";
  } catch {
    badge.textContent = "";
  }
})();

/*************************************************
 * GUARDAS DE ROTA / USUÁRIO
 *************************************************/
function isLogged() {
  return !!(
    sessionStorage.getItem("air_user") ||
    localStorage.getItem("air_user")
  );
}

function getCargoAtual() {
  return (
    sessionStorage.getItem("cargo") ||
    localStorage.getItem("userRole") ||
    ""
  ).toLowerCase();
}

function role() {
  return getCargoAtual(); // já vem em minúsculo
}

/** Requer login; se não tiver, volta pro index */
function requireLogin() {
  if (!isLogged()) {
    alert("Faça login para continuar.");
    window.location.href = "index.html";
  }
}

/** Aceita apenas os papéis informados; caso contrário volta ao dashboard */
function requireRole(allowedRoles = []) {
  const r = (role() || "").toLowerCase();
  const lista = allowedRoles.map((x) => String(x).toLowerCase());
  if (!r || (lista.length && !lista.includes(r))) {
    alert("Acesso restrito.");
    window.location.href = "dashboard.html";
  }
}

/*************************************************
 * (OFFLINE) STORAGE helpers para OS
 *************************************************/
function getOS() {
  return JSON.parse(localStorage.getItem("aircontrol_os") || "[]");
}
function setOS(lista) {
  localStorage.setItem("aircontrol_os", JSON.stringify(lista));
}

/*************************************************
 * BASE + HELPERS DE API
 *************************************************/
async function getJson(url, options) {
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// 🔹 ÚNICA função api() (global, usada por tudo)
async function api(path, { method = "GET", data, headers } = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(headers || {})
    },
    mode: "cors"
  };

  if (data !== undefined && method !== "GET" && method !== "HEAD") {
    opts.body = JSON.stringify(data);
  }

  const res = await fetch(url, opts);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} - ${text || res.statusText}`);
  }

  if (res.status === 204) return null;

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json().catch(() => ({}));
  }
  return res.text();
}

function toItems(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (resp.itens && Array.isArray(resp.itens)) return resp.itens;
  if (resp.items && Array.isArray(resp.items)) return resp.items;
  return [];
}

async function tryApi(fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    console.warn("[API falhou, usando offline]:", e.message || e);
    return typeof fallback === "function" ? fallback(e) : fallback;
  }
}

function codigoOSApi(os) {
  try {
    const ano = new Date(os.dataAbertura).getFullYear();
    const seq = String(os.id ?? 0).padStart(3, "0");
    return `OS-${ano}-${seq}`;
  } catch {
    return `OS-${String(os.id ?? "").padStart(3, "0")}`;
  }
}

/*************************************************
 * IndexedDB p/ FOTOS (sem limite prático)
 *************************************************/
const IDB_NAME = "AirControlOS";
const IDB_VERSION = 1;
let idbPromise = null;

function openIDB() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains("photos")) {
        db.createObjectStore("photos", { keyPath: "id" }); // {id, blob, createdAt}
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return idbPromise;
}

async function idbPut(store, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(store).put(value);
  });
}

async function idbGet(store, key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetMany(store, keys) {
  const results = [];
  for (const k of keys) {
    const row = await idbGet(store, k);
    if (row) results.push(row);
  }
  return results;
}

async function savePhotosToIDB(blobs, prefix) {
  const ids = [];
  for (let i = 0; i < blobs.length; i++) {
    const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await idbPut("photos", { id, blob: blobs[i], createdAt: Date.now() });
    ids.push(id);
  }
  return ids;
}

async function getPhotoObjectURLsByIds(ids) {
  const rows = await idbGetMany("photos", ids);
  return rows.map((r) => URL.createObjectURL(r.blob));
}

/*************************************************
 * ORDEM DE SERVIÇO (ordem-servico.html)
 *************************************************/
const formOrdem = document.getElementById("formOrdemServico");

if (formOrdem) {
  // --- GPS / Geolocalização ---
  const btnGeo = document.getElementById("btnGeo");
  if (btnGeo) {
    btnGeo.addEventListener("click", () => {
      if (!navigator.geolocation) {
        alert("Geolocalização não suportada neste navegador.");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const lat = pos.coords.latitude.toFixed(6);
          const lng = pos.coords.longitude.toFixed(6);
          const latEl = document.getElementById("lat");
          const lngEl = document.getElementById("lng");
          if (latEl) latEl.value = lat;
          if (lngEl) lngEl.value = lng;

          const endEl = document.getElementById("endereco");
          try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
            const res = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
            if (res.ok) {
              const data = await res.json();
              if (endEl && data?.display_name) endEl.value = data.display_name;
            }
          } catch { }
        },
        (err) => {
          alert("Não foi possível obter sua localização.");
          console.error(err);
        }
      );
    });
  }

  // --- Equipamentos dinâmicos ---
  const equipBody = document.getElementById("equipBody");
  const btnAddEquip = document.getElementById("btnAddEquip");
  function addEquipRow(data = {}) {
    if (!equipBody) return;
    const tr = document.createElement("tr");
    tr.className = "equip-row";
    tr.innerHTML = `
      <td><input class="eq-patrimonio" placeholder="Patrimônio"></td>
      <td><input class="eq-ambiente"   placeholder="Sala/Setor"></td>
      <td><input class="eq-marca"      placeholder="Marca"></td>
      <td><input class="eq-btus"       placeholder="BTUs"></td>
      <td><input class="eq-modelo"     placeholder="Modelo"></td>
      <td>
        <select class="eq-tipo">
          <option>Normal</option>
          <option>Inverter</option>
        </select>
      </td>
      <td>
        <div class="gas-group">
          <select class="eq-gas">
            <option>R22</option>
            <option>R410A</option>
            <option>R32</option>
            <option>Outro</option>
          </select>
          <input class="eq-gas-outro" placeholder="Descreva o gás (quando 'Outro')" />
        </div>
      </td>
      <td class="acoes nowrap">
        <button type="button" class="danger" onclick="this.closest('tr').remove()">Remover</button>
      </td>
    `;
    tr.querySelector(".eq-patrimonio").value = data.patrimonio || "";
    tr.querySelector(".eq-ambiente").value   = data.ambiente || "";
    tr.querySelector(".eq-marca").value      = data.marca || "";
    tr.querySelector(".eq-btus").value       = data.btus || "";
    tr.querySelector(".eq-modelo").value     = data.modelo || "";
    if (data.tipo) tr.querySelector(".eq-tipo").value = data.tipo;

    const selGas = tr.querySelector(".eq-gas");
    const inpOutro = tr.querySelector(".eq-gas-outro");
    const gasTipoInicial = data.gasTipo || data.gas || "";
    if (gasTipoInicial) {
      selGas.value = ["R22", "R410A", "R32", "Outro"].includes(gasTipoInicial)
        ? gasTipoInicial
        : "Outro";
    }
    if (data.gasOutro) inpOutro.value = data.gasOutro || "";

    function toggleGasOutro() {
      const isOutro = selGas.value === "Outro";
      inpOutro.style.display = isOutro ? "block" : "none";
      if (!isOutro) inpOutro.value = "";
    }
    selGas.addEventListener("change", toggleGasOutro);
    toggleGasOutro();

    equipBody.appendChild(tr);
  }
  if (btnAddEquip) btnAddEquip.addEventListener("click", () => addEquipRow());
  if (equipBody && !equipBody.children.length) addEquipRow();

  // --- Peças / trocas ---
  const pecasBody = document.getElementById("pecasBody");
  const btnAddPeca = document.getElementById("btnAddPeca");
  function addPecaRow(data = {}) {
    if (!pecasBody) return;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input class="pc-item" placeholder="Item / peça"></td>
      <td style="width:120px;"><input class="pc-qtd" type="number" min="0" placeholder="Qtd."></td>
      <td class="acoes nowrap">
        <button type="button" class="danger" onclick="this.closest('tr').remove()">Remover</button>
      </td>
    `;
    tr.querySelector(".pc-item").value = data.item || "";
    tr.querySelector(".pc-qtd").value = data.qtd || "";
    pecasBody.appendChild(tr);
  }
  if (btnAddPeca) btnAddPeca.addEventListener("click", () => addPecaRow());

  // === Fotos (preview + buffers para IndexedDB) ===
  const beforeInput = document.getElementById("fotosAntes");
  const afterInput  = document.getElementById("fotosDepois");
  const beforePreview = document.getElementById("previewAntes");
  const afterPreview  = document.getElementById("previewDepois");

  let fotosAntesBlobs = [];
  let fotosDepoisBlobs = [];

  function bindPreview(input, container, targetArr) {
    if (!input || !container) return;
    input.addEventListener("change", async () => {
      container.innerHTML = "";
      targetArr.length = 0;
      const files = Array.from(input.files || []);
      for (const f of files) {
        targetArr.push(f);
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.src = reader.result;
          container.appendChild(img);
        };
        reader.readAsDataURL(f);
      }
    });
  }
  bindPreview(beforeInput, beforePreview, fotosAntesBlobs);
  bindPreview(afterInput,  afterPreview,  fotosDepoisBlobs);

  // ===== DATALISTS: Local & Técnico =====
  async function carregarListasNovaOS() {
    try {
      const cli = await getJson(`${API_BASE}/api/Clientes?page=1&pageSize=1000`);
      const tec = await getJson(`${API_BASE}/api/Tecnicos?page=1&pageSize=1000`);

      const locais = toItems(cli);
      const tecnicos = toItems(tec);

      const dlLocal    = document.getElementById("dlLocal");
      const dlTecnicos = document.getElementById("dlTecnicos");
      const inLocalTxt = document.getElementById("osLocalTxt");
      const inTecTxt   = document.getElementById("osTecnicoTxt");
      const hidLocal   = document.getElementById("osLocal");
      const hidTec     = document.getElementById("osTecnico");

      if (!dlLocal || !dlTecnicos) return;

      dlLocal.innerHTML = locais
        .map((c) => `<option value="${(c.nome || "").replace(/"/g, "&quot;")}${c.endereco ? " — " + c.endereco : ""}" data-id="${c.id}"></option>`)
        .join("");

      dlTecnicos.innerHTML = tecnicos
        .map((t) => `<option value="${(t.nome || "").replace(/"/g, "&quot;")}" data-id="${t.id}"></option>`)
        .join("");

      function bindInputToHidden(inputTextEl, datalistEl, hiddenIdEl) {
        function sync() {
          const val = inputTextEl.value.trim();
          let id = 0;
          for (const opt of datalistEl.options) {
            if (opt.value === val) {
              id = parseInt(opt.dataset.id || "0", 10);
              break;
            }
          }
          hiddenIdEl.value = String(id);
        }
        inputTextEl.addEventListener("input", sync);
        inputTextEl.addEventListener("change", sync);
      }

      bindInputToHidden(inLocalTxt, dlLocal, hidLocal);
      bindInputToHidden(inTecTxt, dlTecnicos, hidTec);
    } catch (err) {
      console.warn("Falha ao carregar listas:", err);
      const dlLocal = document.getElementById("dlLocal");
      const dlTecnicos = document.getElementById("dlTecnicos");
      if (dlLocal) dlLocal.innerHTML = "";
      if (dlTecnicos) dlTecnicos.innerHTML = "";
    }
  }
  carregarListasNovaOS();

  // ===== Forward geocoding (endereço -> lat/lng) =====
  const inputEndereco = document.getElementById("endereco");
  const inputLat = document.getElementById("lat");
  const inputLng = document.getElementById("lng");

  async function geocodeEndereco(q) {
    const query = (q || "").trim();
    if (query.length < 3) return;

    async function fetchGeo(url) {
      const res = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
      if (!res.ok) throw new Error("Falha no geocoding");
      const data = await res.json();
      return Array.isArray(data) ? data[0] : null;
    }

    try {
      let first = await fetchGeo(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`
      );
      if (!first) {
        first = await fetchGeo(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
        );
      }
      if (!first) return;

      const lat = Number(first.lat).toFixed(6);
      const lon = Number(first.lon).toFixed(6);
      if (inputLat) inputLat.value = lat;
      if (inputLng) inputLng.value = lon;
    } catch (err) {
      console.warn("Geocoding falhou:", err);
    }
  }

  let geoTimer;
  inputEndereco?.addEventListener("input", () => {
    clearTimeout(geoTimer);
    geoTimer = setTimeout(() => geocodeEndereco(inputEndereco.value), 700);
  });
  inputEndereco?.addEventListener("blur", () => {
    geocodeEndereco(inputEndereco.value);
  });

  // --- SUBMIT (online + offline) ---
  formOrdem.addEventListener("submit", async (e) => {
    e.preventDefault();

    const localId   = parseInt(document.getElementById("osLocal")?.value || "0", 10);
    const tecnicoId = parseInt(document.getElementById("osTecnico")?.value || "0", 10);
    const localNome = (document.getElementById("osLocalTxt")?.value || "").trim();
    const tecnicoNomeTxt = (document.getElementById("osTecnicoTxt")?.value || "").trim();

    const descricao  = (document.getElementById("descricao")?.value || "").trim();
    const prioridade = document.getElementById("prioridade")?.value || "Baixa";
    const status     = document.getElementById("status")?.value || "Aberta";
    const observacoes = (document.getElementById("observacoes")?.value || "").trim();

    if (!descricao) {
      alert("Informe pelo menos a descrição do serviço.");
      return;
    }

    const ok = await tryApi(
      async () => {
        await api(`/api/OrdensServico`, {
          method: "POST",
          data: { clienteId: localId, tecnicoId, descricao, prioridade, status, observacoes }
        });
        alert("OS criada com sucesso!");
        window.location.href = "dashboard.html";
        return true;
      },
      async () => {
        const endereco = (document.getElementById("endereco")?.value || "").trim();
        const lat = document.getElementById("lat")?.value || "";
        const lng = document.getElementById("lng")?.value || "";

        const antesIds  = await savePhotosToIDB(fotosAntesBlobs, "antes");
        const depoisIds = await savePhotosToIDB(fotosDepoisBlobs, "depois");

        const equipamentos = [];
        (equipBody ? Array.from(equipBody.querySelectorAll("tr")) : []).forEach((tr) => {
          const gas = tr.querySelector(".eq-gas")?.value || "";
          const outro = tr.querySelector(".eq-gas-outro")?.value || "";

          equipamentos.push({
            patrimonio: tr.querySelector(".eq-patrimonio")?.value || "",
            ambiente:   tr.querySelector(".eq-ambiente")?.value   || "",
            marca:      tr.querySelector(".eq-marca")?.value      || "",
            btus:       tr.querySelector(".eq-btus")?.value       || "",
            modelo:     tr.querySelector(".eq-modelo")?.value     || "",
            tipo:       tr.querySelector(".eq-tipo")?.value       || "Normal",

            gasTipo: gas,
            gasOutro: gas === "Outro" ? outro : "",
            serie: ""
          });
        });

        const pecas = [];
        (pecasBody ? Array.from(pecasBody.querySelectorAll("tr")) : []).forEach((tr) => {
          pecas.push({
            item: tr.querySelector(".pc-item")?.value || "",
            qtd:  tr.querySelector(".pc-qtd")?.value  || ""
          });
        });

        const seq = (getOS().length + 1).toString().padStart(3, "0");
        const ano = new Date().getFullYear();
        const osCode = `OS-${ano}-${seq}`;

        const dados = {
          id: Date.now(),
          codigo: osCode,
          localNome: localNome || endereco || "-",
          tecnico: tecnicoNomeTxt || "-",
          descricao,
          prioridade,
          status,
          observacoes,
          criadoEm: new Date().toISOString(),
          concluidaEm: /conclu/i.test(status) ? new Date().toISOString() : null,
          local: { endereco, lat, lng },
          equipamento: equipamentos,
          pecas,
          fotosAntesIds: antesIds,
          fotosDepoisIds: depoisIds
        };

        const lista = getOS();
        lista.push(dados);
        setOS(lista);
        alert("OS salva (modo offline).");
        window.location.href = "dashboard.html";
        return true;
      }
    );

    if (!ok) alert("Não foi possível salvar a OS.");
  });
}

/*************************************************
 * LOCAIS (local.html) – BOTÃO "USAR MINHA LOCALIZAÇÃO"
 *************************************************/
const btnGeoLocal = document.getElementById("btnGeoLocal");

async function reverseGeocodeLocal(lat, lng) {
  const enderecoEl = document.getElementById("enderecoLocal");
  if (!enderecoEl) return;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=pt-BR`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Falha ao consultar endereço");

    const data = await res.json();
    const a = data.address || {};

    const partes = [
      [a.road, a.house_number].filter(Boolean).join(", "),
      a.suburb || a.neighbourhood,
      a.city || a.town || a.village,
      a.state,
      a.postcode
    ].filter(Boolean);

    enderecoEl.value = partes.join(" - ") || data.display_name || "";
  } catch (e) {
    console.warn("reverseGeocodeLocal:", e.message);
  }
}

if (btnGeoLocal) {
  btnGeoLocal.addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Seu navegador não suporta geolocalização.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);

        const latInput = document.getElementById("latLocal");
        const lngInput = document.getElementById("lngLocal");

        if (latInput) latInput.value = lat;
        if (lngInput) lngInput.value = lng;

        reverseGeocodeLocal(lat, lng);
      },
      (err) => {
        console.warn(err);
        alert("Não foi possível obter sua localização.");
      }
    );
  });

  ["latLocal", "lngLocal"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const la = parseFloat(document.getElementById("latLocal").value);
      const ln = parseFloat(document.getElementById("lngLocal").value);
      if (!isNaN(la) && !isNaN(ln)) {
        reverseGeocodeLocal(la, ln);
      }
    });
  });
}

/*************************************************
 * DASHBOARD (dashboard.html)
 *************************************************/
const elA = document.getElementById("osAbertas");
const elM = document.getElementById("osAndamento");
const elC = document.getElementById("osConcluidas");
const tbody = document.getElementById("tbodyOS");
const msgVazia = document.getElementById("msgVazia");
const buscaOS = document.getElementById("buscaOS");

async function preencherContadores() {
  if (!elA || !elM || !elC) return;

  // 1º: se existe OS offline, usa só elas
  const offline = getOS();
  if (offline.length) {
    let a = 0, em = 0, c = 0;
    for (const os of offline) {
      const st = (os.status || "").toLowerCase();
      if (st.includes("andamento")) em++;
      else if (st.includes("conclu")) c++;
      else a++;
    }
    elA.textContent = a;
    elM.textContent = em;
    elC.textContent = c;
    return;
  }

  // 2º: se não houver nada offline, tenta API
  await tryApi(
    async () => {
      const c = await api(`/api/OrdensServico/contagem`);
      elA.textContent = c.abertas ?? 0;
      elM.textContent = c.andamento ?? 0;
      elC.textContent = c.concluidas ?? 0;
    },
    () => {
      elA.textContent = 0;
      elM.textContent = 0;
      elC.textContent = 0;
    }
  );
}

function fmtData(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("pt-BR") +
      " " +
      d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return "-";
  }
}

function getLocalDateStr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`; // ex: "2025-12-07"
}

async function renderTabela(filtro = "Todas") {
  if (!tbody) return;

  // 1º: se existir OS offline, usa SÓ elas
  const listaOffline = getOS();
  if (listaOffline.length) {
    const termoBusca = (buscaOS?.value || "").trim();
    const filtrada = listaOffline.filter((os) => {
      const byStatus =
        filtro === "Todas" ||
        (os.status || "").toLowerCase().includes(filtro.toLowerCase());
      const texto = `${os.codigo || ""} ${os.localNome || ""} ${os.local?.endereco || ""}`.toLowerCase();
      const byBusca = termoBusca ? texto.includes(termoBusca.toLowerCase()) : true;
      return byStatus && byBusca;
    });

    tbody.innerHTML = "";
    if (!filtrada.length) {
      if (msgVazia) msgVazia.style.display = "block";
      return;
    }
    if (msgVazia) msgVazia.style.display = "none";

    filtrada
      .sort((a, b) => (b.criadoEm || 0).localeCompare(a.criadoEm || 0))
      .forEach((os) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="nowrap">${os.codigo || "-"}</td>
          <td>${os.localNome || os.local?.endereco || "-"}</td>
          <td>${os.tecnico || "-"}</td>
          <td>${os.prioridade || "-"}</td>
          <td class="status-cell">
            <select class="status-select" onchange="alterarStatus(${os.id}, this.value)">
              <option value="Aberta" ${os.status === "Aberta" ? "selected" : ""}>Aberta</option>
              <option value="Em Andamento" ${os.status === "Em Andamento" ? "selected" : ""}>Em Andamento</option>
              <option value="Concluída" ${os.status === "Concluída" ? "selected" : ""}>Concluída</option>
            </select>
          </td>
          <td class="nowrap">${fmtData(os.criadoEm)}</td>
          <td class="nowrap">${os.concluidaEm ? fmtData(os.concluidaEm) : "-"}</td>
          <td class="acoes nowrap">
            <button class="link" onclick="abrirModal(${os.id})">Detalhes</button>
            &nbsp;|&nbsp;
            <button class="link danger" title="Excluir" onclick="excluirOS(${os.id})">Excluir</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    return;
  }

  // 2º: se NÃO houver nada offline, tenta API normalmente
  await tryApi(
    // ONLINE
    async () => {
      const params = new URLSearchParams();
      if (filtro && filtro !== "Todas") params.set("status", filtro);
      const q = (buscaOS?.value || "").trim();
      if (q) params.set("q", q);
      params.set("page", "1");
      params.set("pageSize", "100");

      const resp = await api(`/api/OrdensServico?${params.toString()}`);
      const itens = toItems(resp);

      tbody.innerHTML = "";
      if (itens.length === 0) {
        if (msgVazia) msgVazia.style.display = "block";
        return;
      }
      if (msgVazia) msgVazia.style.display = "none";

      itens.forEach((os) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="nowrap">${codigoOSApi(os)}</td>
          <td>${os.cliente?.nome || os.local || "-"}</td>
          <td>${os.tecnico?.nome || "-"}</td>
          <td>${os.prioridade || "-"}</td>
          <td class="nowrap">
            <select class="status-select" onchange="alterarStatus(${os.id}, this.value)">
              <option value="Aberta" ${os.status === "Aberta" ? "selected" : ""}>Aberta</option>
              <option value="Em Andamento" ${os.status === "Em Andamento" ? "selected" : ""}>Em Andamento</option>
              <option value="Concluída" ${os.status === "Concluída" ? "selected" : ""}>Concluída</option>
            </select>
          </td>
          <td class="nowrap">${fmtData(os.dataAbertura)}</td>
          <td class="nowrap">-</td>
          <td class="acoes nowrap">
            <button class="link" onclick="abrirModal(${os.id})">Detalhes</button>
            &nbsp;|&nbsp;
            <button class="link danger" onclick="excluirOS(${os.id})">Excluir</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    },
    // Fallback se API der erro e também não houver offline (caso raro)
    () => {
      tbody.innerHTML = "";
      if (msgVazia) msgVazia.style.display = "block";
    }
  );
}

window.alterarStatus = async function (id, novoStatus) {
  await tryApi(
    async () => {
      await api(`/api/OrdensServico/${id}/status`, {
        method: "PUT",
        data: { status: novoStatus }
      });
      await preencherContadores();
      const ativo =
        document.querySelector(".chip.active")?.getAttribute("data-filter") ||
        "Todas";
      renderTabela(ativo);
    },
    () => {
      const lista = getOS();
      const os = lista.find((o) => o.id === id);
      if (!os) return;
      os.status = novoStatus;
      if ((novoStatus || "").toLowerCase().includes("conclu"))
        os.concluidaEm = new Date().toISOString();
      else os.concluidaEm = null;
      setOS(lista);
      preencherContadores();
      const ativo =
        document.querySelector(".chip.active")?.getAttribute("data-filter") ||
        "Todas";
      renderTabela(ativo);
    }
  );
};

window.excluirOS = async function (id) {
  if (!confirm("Excluir esta OS?")) return;
  await tryApi(
    async () => {
      await api(`/api/OrdensServico/${id}`, { method: "DELETE" });
      await preencherContadores();
      const ativo =
        document.querySelector(".chip.active")?.getAttribute("data-filter") ||
        "Todas";
      renderTabela(ativo);
    },
    () => {
      const lista = getOS().filter((o) => o.id !== id);
      setOS(lista);
      preencherContadores();
      const ativo =
        document.querySelector(".chip.active")?.getAttribute("data-filter") ||
        "Todas";
      renderTabela(ativo);
    }
  );
};

if (buscaOS) {
  buscaOS.addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
      const ativo =
        document.querySelector(".chip.active")?.getAttribute("data-filter") ||
        "Todas";
      renderTabela(ativo);
    }
  });
}

(function initDashboard() {
  if (!elA || !elM || !elC || !tbody) return;
  preencherContadores();
  renderTabela("Todas");

  const chips = document.querySelectorAll(".chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const filtro = chip.getAttribute("data-filter") || "Todas";
      renderTabela(filtro);
    });
  });
})();

/*************************************************
 * TÉCNICO (tecnico.html)
 *************************************************/
const formTecnico = document.getElementById("formTecnico");
if (formTecnico) {
  const selCargoTec = document.getElementById("cargo");
  if (selCargoTec && Array.isArray(CARGOS)) {
    selCargoTec.innerHTML = CARGOS.map((c) => `<option value="${c}">${c}</option>`).join("");
    if (!selCargoTec.value) selCargoTec.value = "Tecnico";
  }

  formTecnico.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nome = document.getElementById("nome").value.trim();
    const email = document.getElementById("email").value.trim();
    const telefone = document.getElementById("telefone").value.trim();
    const cargo = (document.getElementById("cargo")?.value || "Tecnico").trim();

    if (!nome || !email) {
      alert("Preencha pelo menos nome e email.");
      return;
    }

    try {
      await api(`/api/Tecnicos`, {
        method: "POST",
        data: { nome, email, telefone, cargo }
      });

      alert("Técnico salvo com sucesso!");
      formTecnico.reset();
      if (selCargoTec) selCargoTec.value = "Tecnico";
    } catch (err) {
      const msg = String(err.message || "");
      if (msg.startsWith("409")) {
        alert("Este e-mail já está cadastrado (409 Conflict).");
      } else {
        alert("Falha ao salvar técnico:\n" + msg);
      }
    }
  });
}

/*************************************************
 * Modal Detalhes (dashboard.html)
 *************************************************/
let modalOSId = null;

async function preencherModalComAPI(id) {
  const os = await api(`/api/OrdensServico/${id}`);
  const setTxt = (i, v) => {
    const el = document.getElementById(i);
    if (el) el.textContent = v || "-";
  };

  setTxt("detLocal",      os.cliente?.nome || os.local || "-");
  setTxt("detTecnico",    os.tecnico?.nome || "-");
  setTxt("detPrioridade", os.prioridade || "-");
  setTxt("detCriadaEm",   fmtData(os.dataAbertura));
  setTxt("detConcluidaEm","-");
  setTxt("detDescricao",  os.descricao || "-");

  setTxt("detTipo",   os.equipamento?.tipo   || "-");
  setTxt("detBtus",   os.equipamento?.btus   || "-");
  setTxt("detMarca",  os.equipamento?.marca  || "-");
  setTxt("detModelo", os.equipamento?.modelo || "-");
  setTxt("detSerie",  os.equipamento?.serie  || "-");

  setTxt("detEndereco", os.endereco || os.cliente?.endereco || "-");

  const sel = document.getElementById("detStatus");
  if (sel) {
    sel.innerHTML = `
      <option value="Aberta" ${os.status==="Aberta"?"selected":""}>Aberta</option>
      <option value="Em Andamento" ${os.status==="Em Andamento"?"selected":""}>Em Andamento</option>
      <option value="Concluída" ${os.status==="Concluída"?"selected":""}>Concluída</option>
    `;
  }
}

window.abrirModal = async function (id) {
  const modal = document.getElementById("modalOS");
  if (!modal) return;
  modalOSId = id;

  await tryApi(
    async () => preencherModalComAPI(id),
    async () => {
      const os = getOS().find((o) => o.id === id);
      if (!os) return;

      const setTxt = (i, v) => {
        const el = document.getElementById(i);
        if (el) el.textContent = v || "-";
      };

      setTxt("detLocal",      os.localNome || os.local?.endereco || "-");
      setTxt("detTecnico",    os.tecnico || "-");
      setTxt("detPrioridade", os.prioridade);
      setTxt("detCriadaEm",   fmtData(os.criadoEm));
      setTxt("detConcluidaEm",fmtData(os.concluidaEm));
      setTxt("detDescricao",  os.descricao || "-");

      const eq = (os.equipamento && os.equipamento[0]) || {};
      setTxt("detTipo",   eq.tipo   || "-");
      setTxt("detBtus",   eq.btus   || "-");
      setTxt("detMarca",  eq.marca  || "-");
      setTxt("detModelo", eq.modelo || "-");
      setTxt("detSerie",  eq.serie  || "-");

      setTxt("detEndereco", os.local?.endereco || "-");

      const corpo = document.querySelector("#detTabelaPecas tbody");
      if (corpo) {
        corpo.innerHTML = "";
        (os.pecas || []).forEach((p) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${p.item || "-"}</td><td>${p.qtd || "-"}</td>`;
          corpo.appendChild(tr);
        });
        if ((os.pecas || []).length === 0) {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td colspan="2">-</td>`;
          corpo.appendChild(tr);
        }
      }

      async function renderFotos(containerId, fotosIds, fotosDataURLs) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = "";

        if (Array.isArray(fotosDataURLs) && fotosDataURLs.length) {
          fotosDataURLs.forEach((src) => {
            const img = new Image();
            img.src = src;
            el.appendChild(img);
          });
          return;
        }

        const urls = await getPhotoObjectURLsByIds(fotosIds || []);
        urls.forEach((src) => {
          const img = new Image();
          img.src = src;
          el.appendChild(img);
        });
      }
      await renderFotos("detFotosAntes",  os.fotosAntesIds,  os.fotosAntes);
      await renderFotos("detFotosDepois", os.fotosDepoisIds, os.fotosDepois);

      const mapEl = document.getElementById("detMap");
      if (mapEl) {
        mapEl.innerHTML = "";
        if (typeof L !== "undefined" && os.local?.lat && os.local?.lng) {
          const lat = parseFloat(os.local.lat), lng = parseFloat(os.local.lng);
          const map = L.map(mapEl).setView([lat, lng], 14);
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap"
          }).addTo(map);
          L.marker([lat, lng]).addTo(map);
        }
      }
    }
  );

  modal.style.display = "flex";
};

window.fecharModal = function () {
  const modal = document.getElementById("modalOS");
  if (!modal) return;
  modal.style.display = "none";
  modalOSId = null;
};

window.salvarStatusModal = function () {
  if (modalOSId == null) return;
  const novo = document.getElementById("detStatus").value;
  alterarStatus(modalOSId, novo);
  fecharModal();
};

/*************************************************
 * GERAÇÃO DE PDF DA ORDEM DE SERVIÇO (jsPDF)
 *  – continua aqui se você quiser o modelo antigo.
 *************************************************/

/** Carrega uma OS (online ou offline) pelo id */
async function carregarOSPorId(id) {
  let os = null;
  await tryApi(
    async () => {
      os = await api(`/api/OrdensServico/${id}`);
    },
    () => {
      os = getOS().find((o) => o.id === id);
    }
  );
  return os;
}

/** Gera o PDF da OS atualmente aberta no modal (modelo antigo em texto) */
window.gerarPdfOrdem = async function () {
  if (modalOSId == null) {
    alert("Abra uma OS e depois clique em Gerar PDF.");
    return;
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("Biblioteca jsPDF não encontrada nesta página.");
    return;
  }

  const os = await carregarOSPorId(modalOSId);
  if (!os) {
    alert("Não foi possível localizar os dados da OS.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // ========= 1) CARREGAR LOGOS E DESENHAR NO TOPO =========
  try {
    const [logoPref, logoMaxi] = await Promise.all([
      carregarImagem("imagem/logo-prefeitura-sv.png"),
      carregarImagem("imagem/logo-Maxi.png")
    ]);

    // esquerda (prefeitura)
    doc.addImage(logoPref, "PNG", 15, 8, 25, 18);
    // direita (Maxi)
    doc.addImage(logoMaxi, "PNG", 170, 8, 25, 18);
  } catch (e) {
    console.warn("Não foi possível carregar os logos no PDF:", e);
  }

  // ========= 2) DADOS DA OS (MANTENDO SEU LAYOUT) =========
  const codigo = os.codigo || codigoOSApi(os);
  const dataAbertura = os.dataAbertura || os.criadoEm || new Date().toISOString();

  // 👉 AQUI TIRA O HORÁRIO: só a data em pt-BR
  let dataAberturaBR = "-";
  try {
    dataAberturaBR = new Date(dataAbertura).toLocaleDateString("pt-BR");
  } catch {}

  const local =
    os.cliente?.nome ||
    os.localNome ||
    os.local?.endereco ||
    os.local ||
    "-";
  const tecnico = os.tecnico?.nome || os.tecnico || "-";
  const prioridade = os.prioridade || "-";
  const descricao = os.descricao || "-";
  const observacoes = os.observacoes || os.observacao || "-";

  const eq = Array.isArray(os.equipamento)
    ? (os.equipamento[0] || {})
    : (os.equipamento || {});
  const patrimonio = eq.patrimonio || "-";
  const marca = eq.marca || "-";
  const btus = eq.btus || "-";
  const modelo = eq.modelo || "-";
  const tipo = eq.tipo || "-";

  // Começa um pouco mais embaixo por causa dos logos
  let y = 28;

  doc.setFontSize(14);
  doc.text(
    "FICHA DE MANUTENÇÃO CORRETIVA DE APARELHOS DE AR CONDICIONADO",
    105,
    y,
    { align: "center" }
  );

  y += 8;
  doc.setFontSize(11);
  doc.text(`Ordem de Serviço: ${codigo}`, 14, y);
  // 👉 Usa só a data (sem hora)
  doc.text(`Data: ${dataAberturaBR}`, 120, y);
  y += 8;

  doc.text(`Local / Unidade: ${local}`, 14, y);
  y += 6;
  doc.text(`Técnico: ${tecnico}`, 14, y);
  y += 6;
  doc.text(`Prioridade: ${prioridade}`, 14, y);
  y += 10;

  doc.setFontSize(12);
  doc.text("Dados do Equipamento", 14, y);
  y += 6;
  doc.setFontSize(11);
  doc.text(`Patrimônio: ${patrimonio}`, 14, y);
  y += 6;
  doc.text(`Marca: ${marca}`, 14, y);
  y += 6;
  doc.text(`Modelo: ${modelo}`, 14, y);
  y += 6;
  doc.text(`BTU/h: ${btus}`, 14, y);
  y += 6;
  doc.text(`Tipo (Normal / Inverter): ${tipo}`, 14, y);
  y += 10;

  doc.setFontSize(12);
  doc.text("Descrição do Serviço", 14, y);
  y += 6;
  doc.setFontSize(11);
  const descricaoLines = doc.splitTextToSize(descricao || "-", 180);
  doc.text(descricaoLines, 14, y);
  y += descricaoLines.length * 6 + 4;

  doc.setFontSize(12);
  doc.text("Observações", 14, y);
  y += 6;
  doc.setFontSize(11);
  const obsLines = doc.splitTextToSize(observacoes || "-", 180);
  doc.text(obsLines, 14, y);
  y += obsLines.length * 6 + 10;

  doc.setFontSize(11);
  doc.text("Responsável pela manutenção: ________________________________", 14, y);
  y += 8;
  doc.text("Responsável pela unidade de saúde: ___________________________", 14, y);

  doc.save(`OS_${codigo}.pdf`);
};

/*************************************************
 * FICHA CORRETIVA – PDF IGUAL AO BLOCO (duas vias)
 *************************************************/

// ficha: {unidade, data, patrimonio, local, marca, btu, modelo, tipo, info}
function imprimirCorretiva(ficha) {
  const div = document.getElementById('printCorretiva');
  if (!div) {
    alert("Modelo da ficha corretiva (printCorretiva) não encontrado nesta página.");
    return;
  }

  // função auxiliar para preencher uma via
  function preencherVia(prefixo) {
    const set = (idSuf, val) => {
      const el = document.getElementById(prefixo + '_' + idSuf);
      if (el) el.textContent = val || '';
    };
    set('unidade', ficha.unidade || '');
    set('data',    ficha.data || '');
    set('patrimonio', ficha.patrimonio || '');
    set('local',   ficha.local || '');
    set('marca',   ficha.marca || '');
    set('btu',     ficha.btu || '');
    set('modelo',  ficha.modelo || '');
    set('tipo',    ficha.tipo || '');
    set('info',    ficha.info || '');
  }

  preencherVia('cor1');
  preencherVia('cor2');

  div.style.display = 'block';

  const opt = {
    margin: 10,
    filename: `Ficha-Corretiva-${ficha.unidade || ''}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().from(div).set(opt).save().then(() => {
    div.style.display = 'none';
  });
}

