/* STUDIUM Plataforma | vistoria em campo (offline), clientes e obras, usuários, módulos */
(function () {
  "use strict";
  var CFG = window.CFG;
  var DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var MB_POR_FOTO = 0.6;           // estimativa para o medidor do plano gratuito (1 GB)
  var LIMITE_LEGENDA = 205;        // 3 linhas no relatório

  var S = {
    sb: null, user: null, perfil: null, obras: [], clientes: [], perfis: [], logos: {}, clienteSel: null, obraSel: null, menuAberto: false, obraId: null, regs: [], fila: [], edicoes: {},
    minis: new Map(), aba: "inicio", online: navigator.onLine, sincronizando: false, precisaLogin: false,
    mes: new Date(), diaSel: null, msg: "", obraEdit: null, exportando: "", confirmar: null, carregou: false
  };
  var idb = null, pendRender = false, timerRefresh = null;
  var app = document.getElementById("app");

  // ---------------------------------------------------------------- utilidades
  function h(tag, props) {
    var e = document.createElement(tag), p = props || {};
    Object.keys(p).forEach(function (k) {
      var v = p[k];
      if (k === "class") e.className = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = !!v;
      else if (k === "disabled" || k === "multiple") { if (v) e.setAttribute(k, ""); }
      else if (v !== false && v != null) e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(e, x); }); return; }
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function diaDe(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseDia(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function segundaDe(dia) { var d = parseDia(dia), w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d; }
  function ddmm(d) { return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); }
  function sexta(seg) { var f = parseDia(seg); f.setDate(f.getDate() + 4); return f; }
  function rotuloSemana(seg) { var s = parseDia(seg), f = sexta(seg); return "SEMANA " + ddmm(s) + " A " + ddmm(f) + "/" + String(f.getFullYear()).slice(2); }
  function rotuloDia(dia) { var d = parseDia(dia); return DIAS[d.getDay()] + ", " + ddmm(d); }
  function hora(ts) { var d = new Date(ts); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function novoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
  }
  function msgErro(e) { return (e && (e.message || e.error_description || e.error)) || String(e); }
  function guardado(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  // ---------------------------------------------------------------- IndexedDB
  function abrirIDB() {
    return new Promise(function (res, rej) {
      var rq = indexedDB.open("vistoria-pwa", 1);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        ["fila", "edicoes", "minis"].forEach(function (n) { d.createObjectStore(n, { keyPath: "id" }); });
        d.createObjectStore("cache", { keyPath: "k" });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function tx(store, modo, fn) {
    return new Promise(function (res, rej) {
      var t = idb.transaction(store, modo), r = fn(t.objectStore(store));
      t.oncomplete = function () { res(r && r.result); };
      t.onerror = t.onabort = function () { rej(t.error); };
    });
  }
  var dbPut = function (s, v) { return tx(s, "readwrite", function (st) { return st.put(v); }); };
  var dbDel = function (s, k) { return tx(s, "readwrite", function (st) { return st.delete(k); }); };
  var dbTodos = function (s) { return tx(s, "readonly", function (st) { return st.getAll(); }); };
  var dbGet = function (s, k) { return tx(s, "readonly", function (st) { return st.get(k); }); };

  // ---------------------------------------------------------------- imagem
  function lerDataExif(buf) {
    try {
      var v = new DataView(buf);
      if (v.getUint16(0) !== 0xFFD8) return null;
      var off = 2;
      while (off < v.byteLength - 4) {
        var marker = v.getUint16(off), len = v.getUint16(off + 2);
        if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
          var t = off + 10, le = v.getUint16(t) === 0x4949;
          var g16 = function (o) { return v.getUint16(t + o, le); };
          var g32 = function (o) { return v.getUint32(t + o, le); };
          var ifd0 = g32(4), n = g16(ifd0), exifPtr = 0;
          for (var i = 0; i < n; i++) { if (g16(ifd0 + 2 + i * 12) === 0x8769) exifPtr = g32(ifd0 + 2 + i * 12 + 8); }
          if (!exifPtr) return null;
          var m = g16(exifPtr);
          for (var j = 0; j < m; j++) {
            var e = exifPtr + 2 + j * 12;
            if (g16(e) === 0x9003) {
              var p = g32(e + 8), s = "";
              for (var k = 0; k < 19; k++) s += String.fromCharCode(v.getUint8(t + p + k));
              var r = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
              if (r) return new Date(+r[1], +r[2] - 1, +r[3], +r[4], +r[5], +r[6]);
            }
          }
          return null;
        }
        off += 2 + len;
      }
    } catch (e) { /* sem EXIF */ }
    return null;
  }
  function carregarImg(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("imagem inválida")); };
      im.src = u;
    });
  }
  function toBlob(c, q) { return new Promise(function (res) { c.toBlob(res, "image/jpeg", q); }); }
  async function reduzir(src, w, h, max, q) {
    var esc = Math.min(1, max / Math.max(w, h)), cw = Math.round(w * esc), ch = Math.round(h * esc);
    var c = document.createElement("canvas"); c.width = cw; c.height = ch;
    c.getContext("2d").drawImage(src, 0, 0, cw, ch);
    return { blob: await toBlob(c, q), w: cw, h: ch };
  }
  async function processar(file) {
    var src, w, hh;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; hh = src.height; }
    catch (e) { src = await carregarImg(file); w = src.naturalWidth; hh = src.naturalHeight; }
    var grande = await reduzir(src, w, hh, 2000, 0.82), mini = await reduzir(src, w, hh, 360, 0.7), data = null;
    try { data = lerDataExif(await file.slice(0, 131072).arrayBuffer()); } catch (e) { /* ignora */ }
    if (!data) data = file.lastModified ? new Date(file.lastModified) : new Date();
    return { blob: grande.blob, thumb: mini.blob, w: grande.w, h: grande.h, data: data };
  }

  // ---------------------------------------------------------------- dados
  function obraAtual() { return S.obras.find(function (o) { return o.id === S.obraId; }) || null; }
  function ehAdmin() { return !!(S.perfil && S.perfil.papel === "admin"); }
  function caminhoMini(p) { return p.replace(/\.jpg$/, "_t.jpg"); }

  function itensDaObra() {
    var ids = {}, itens = [];
    S.fila.forEach(function (p) { if (p.obra_id === S.obraId) { ids[p.id] = 1; itens.push(Object.assign({ _pend: true }, p)); } });
    S.regs.forEach(function (r) {
      if (r.obra_id === S.obraId && !ids[r.id]) {
        var ed = S.edicoes[r.id];
        itens.push(Object.assign({}, r, ed ? ed.campos : {}));
      }
    });
    itens.sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
    return itens;
  }

  async function carregarLocal() {
    S.fila = await dbTodos("fila");
    (await dbTodos("edicoes")).forEach(function (e) { S.edicoes[e.id] = e; });
    var c;
    c = await dbGet("cache", "obras"); if (c) S.obras = c.v;
    c = await dbGet("cache", "perfil"); if (c) S.perfil = c.v;
    c = await dbGet("cache", "regs"); if (c) S.regs = c.v;
    c = await dbGet("cache", "clientes"); if (c) S.clientes = c.v;
    c = await dbGet("cache", "perfis"); if (c) S.perfis = c.v;
    (await dbTodos("minis")).forEach(function (m) { S.minis.set(m.id, URL.createObjectURL(m.blob)); });
    var guardada = guardado("obra");
    S.obraId = (S.obras.some(function (o) { return o.id === guardada; }) ? guardada : (S.obras[0] && S.obras[0].id)) || null;
  }

  async function paginar(consulta) {
    var tudo = [], de = 0, passo = 1000;
    for (;;) {
      var r = await consulta().range(de, de + passo - 1);
      if (r.error) throw r.error;
      tudo = tudo.concat(r.data);
      if (r.data.length < passo) break;
      de += passo;
    }
    return tudo;
  }

  async function carregarNuvem() {
    if (!S.online || !S.sb || !S.user) return;
    try {
      var obras = await paginar(function () { return S.sb.from("obras").select("*").order("nome_exibicao"); });
      var perfil = await S.sb.from("perfis").select("*").eq("user_id", S.user.id).maybeSingle();
      var regs = await paginar(function () { return S.sb.from("registros").select("*").order("ts", { ascending: false }); });
      var clientes = await paginar(function () { return S.sb.from("clientes").select("*").order("razao_social"); });
      var perfis = await paginar(function () { return S.sb.from("perfis").select("*").order("email"); });
      S.obras = obras; S.perfil = perfil.data || S.perfil; S.regs = regs; S.clientes = clientes; S.perfis = perfis;
      await dbPut("cache", { k: "clientes", v: clientes });
      await dbPut("cache", { k: "perfis", v: perfis });
      await dbPut("cache", { k: "obras", v: obras });
      await dbPut("cache", { k: "perfil", v: S.perfil });
      await dbPut("cache", { k: "regs", v: regs });
      if (!S.obras.some(function (o) { return o.id === S.obraId; })) S.obraId = S.obras[0] ? S.obras[0].id : null;
      S.carregou = true;
      render();
      carregarLogos().then(render);
      preencherMinis();
    } catch (e) { S.msg = "Não foi possível atualizar agora: " + msgErro(e); render(); }
  }

  async function preencherMinis() {
    if (!S.online || !S.sb) return;
    var faltam = S.regs.filter(function (r) { return !S.minis.has(r.id) && r.foto_path; }).slice(0, 300);
    for (var i = 0; i < faltam.length; i += 40) {
      var lote = faltam.slice(i, i + 40);
      var r = await S.sb.storage.from("fotos").createSignedUrls(lote.map(function (x) { return caminhoMini(x.foto_path); }), 3600);
      if (r.error) return;
      await Promise.all(r.data.map(async function (it, k) {
        if (!it.signedUrl) return;
        try {
          var blob = await (await fetch(it.signedUrl)).blob();
          await dbPut("minis", { id: lote[k].id, blob: blob });
          S.minis.set(lote[k].id, URL.createObjectURL(blob));
        } catch (e) { /* tenta na próxima */ }
      }));
      render();
    }
  }

  // ---------------------------------------------------------------- sincronização
  async function subir(caminho, blob) {
    var r = await S.sb.storage.from("fotos").upload(caminho, blob, { contentType: "image/jpeg", upsert: false });
    if (r.error && !(String(r.error.statusCode) === "409" || /exists|Duplicate/i.test(r.error.message || ""))) throw r.error;
  }
  async function enviarItem(it) {
    var cam = it.obra_id + "/" + it.dia + "/" + it.id + ".jpg";
    await subir(cam, it.blob);
    await subir(caminhoMini(cam), it.thumb);
    var r = await S.sb.from("registros").insert({
      id: it.id, obra_id: it.obra_id, dia: it.dia, ts: it.ts, semana: it.semana, local: it.local || "",
      legenda: it.legenda || "", entra: it.entra !== false, foto_path: cam, w: it.w, h: it.h
    });
    if (r.error && r.error.code !== "23505") throw r.error;
  }
  async function sincronizar(manual) {
    if (S.sincronizando || !S.sb) return;
    if (!navigator.onLine) { if (manual) { S.msg = "Sem internet no momento. O envio será feito automaticamente quando voltar."; render(); } return; }
    var ses = await S.sb.auth.getSession();
    if (!ses.data.session) { S.precisaLogin = true; render(); return; }
    S.sincronizando = true; render();
    try {
      var fila = (await dbTodos("fila")).sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
      for (var i = 0; i < fila.length; i++) {
        var it = fila[i], ref = S.fila.find(function (x) { return x.id === it.id; });
        if (ref) { ref.estado = "enviando"; render(); }
        try {
          await enviarItem(it);
          await dbDel("fila", it.id);
          S.fila = S.fila.filter(function (x) { return x.id !== it.id; });
        } catch (e) {
          it.estado = "falha"; it.erro = msgErro(e); await dbPut("fila", it);
          if (ref) { ref.estado = "falha"; ref.erro = it.erro; }
        }
      }
      var eds = await dbTodos("edicoes");
      for (var j = 0; j < eds.length; j++) {
        var r = await S.sb.from("registros").update(eds[j].campos).eq("id", eds[j].id);
        if (!r.error) { await dbDel("edicoes", eds[j].id); delete S.edicoes[eds[j].id]; }
      }
      S.msg = "";
    } finally { S.sincronizando = false; }
    await carregarNuvem();
    render();
  }

  // ---------------------------------------------------------------- ações
  async function aoCapturar(ev) {
    var arqs = Array.prototype.slice.call(ev.target.files || []);
    ev.target.value = "";
    if (!arqs.length || !S.obraId) return;
    for (var i = 0; i < arqs.length; i++) {
      S.msg = "Processando foto " + (i + 1) + " de " + arqs.length + "...";
      render();
      try {
        var f = await processar(arqs[i]), dia = diaDe(f.data);
        var item = {
          id: novoId(), obra_id: S.obraId, dia: dia, ts: f.data.toISOString(), semana: diaDe(segundaDe(dia)),
          local: guardado("local") || "", legenda: "", entra: true, blob: f.blob, thumb: f.thumb, w: f.w, h: f.h, estado: "pendente"
        };
        await dbPut("fila", item);
        S.fila.push(item);
      } catch (e) { S.msg = "Falha ao processar a foto: " + msgErro(e); }
    }
    S.msg = "";
    render();
    sincronizar();
  }
  async function editarCampo(it, campo, valor) {
    if (it._pend) {
      var p = S.fila.find(function (x) { return x.id === it.id; });
      if (!p) return;
      p[campo] = valor; await dbPut("fila", p);
    } else {
      var r = S.regs.find(function (x) { return x.id === it.id; });
      var ed = S.edicoes[it.id] || { id: it.id, campos: {} };
      ed.campos[campo] = valor; S.edicoes[it.id] = ed;
      await dbPut("edicoes", ed);
      if (r) r[campo] = valor;
      if (S.online && S.sb) {
        var u = await S.sb.from("registros").update(ed.campos).eq("id", it.id);
        if (!u.error) { await dbDel("edicoes", it.id); delete S.edicoes[it.id]; }
      }
    }
  }
  function confirmar(chave, fn) {
    if (S.confirmar === chave) { S.confirmar = null; fn(); return; }
    S.confirmar = chave; render();
    setTimeout(function () { if (S.confirmar === chave) { S.confirmar = null; render(); } }, 4000);
  }
  async function remover(it) {
    if (it._pend) {
      await dbDel("fila", it.id); S.fila = S.fila.filter(function (x) { return x.id !== it.id; }); render(); return;
    }
    if (!ehAdmin() || !S.online) { S.msg = "Só a administradora apaga fotos já enviadas, com internet."; render(); return; }
    var r = await S.sb.from("registros").delete().eq("id", it.id);
    if (r.error) { S.msg = "Erro ao apagar: " + msgErro(r.error); render(); return; }
    await S.sb.storage.from("fotos").remove([it.foto_path, caminhoMini(it.foto_path)]);
    S.regs = S.regs.filter(function (x) { return x.id !== it.id; });
    await dbPut("cache", { k: "regs", v: S.regs });
    await dbDel("minis", it.id); S.minis.delete(it.id);
    render();
  }
  async function abrirVisor(it) {
    var url = null;
    if (it._pend) url = URL.createObjectURL(it.blob);
    else if (S.online && S.sb) {
      var r = await S.sb.storage.from("fotos").createSignedUrl(it.foto_path, 600);
      if (r.data) url = r.data.signedUrl;
    }
    if (!url) url = S.minis.get(it.id);
    if (!url) { S.msg = "Foto completa indisponível sem internet."; render(); return; }
    var v = h("div", { id: "visor", onclick: function () { v.remove(); } }, h("img", { src: url }));
    document.body.append(v);
  }

  // ---------------------------------------------------------------- exportação
  function baixar(blob, nome) {
    var a = h("a", { href: URL.createObjectURL(blob), download: nome });
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }
  function csvCel(v) { v = v == null ? "" : String(v); return '"' + v.replace(/"/g, '""') + '"'; }
  async function exportar(de, ate) {
    var obra = obraAtual();
    if (!obra) return;
    if (!S.online) { S.msg = "A exportação precisa de internet."; render(); return; }
    var pend = S.fila.filter(function (p) { return p.obra_id === obra.id && p.dia >= de && p.dia <= ate; }).length;
    var regs = S.regs.filter(function (r) { return r.obra_id === obra.id && r.dia >= de && r.dia <= ate; })
      .sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
    if (!regs.length) { S.msg = "Não há fotos enviadas nesse período."; render(); return; }
    var semanas = {};
    regs.forEach(function (r) { (semanas[r.semana] = semanas[r.semana] || []).push(r); });
    var chaves = Object.keys(semanas).sort();
    var zip = new JSZip(), linhas = ["pasta;ordem;arquivo;dia;hora;local;legenda;entra_no_relatorio;obra"];
    var total = regs.filter(function (r) { return r.entra; }).length, feitas = 0;
    S.exportando = "Preparando..."; render();
    for (var i = 0; i < chaves.length; i++) {
      var seg = chaves[i], pasta = "2." + (i + 1) + "_" + seg + "_" + diaDe(sexta(seg)), n = 0, lista = semanas[seg];
      var comFoto = lista.filter(function (r) { return r.entra; });
      for (var k = 0; k < comFoto.length; k += 40) {
        var lote = comFoto.slice(k, k + 40);
        var su = await S.sb.storage.from("fotos").createSignedUrls(lote.map(function (r) { return r.foto_path; }), 1800);
        if (su.error) { S.exportando = ""; S.msg = "Erro ao preparar fotos: " + msgErro(su.error); render(); return; }
        for (var m = 0; m < lote.length; m++) {
          var r = lote[m]; n++;
          var nome = String(n).padStart(3, "0") + "_" + hora(r.ts).replace(":", "") + "_" + r.id.slice(0, 8) + ".jpg";
          try { zip.file(pasta + "/" + nome, await (await fetch(su.data[m].signedUrl)).blob()); r._arq = nome; }
          catch (e) { S.exportando = ""; S.msg = "Falha ao baixar uma foto. Tente novamente."; render(); return; }
          feitas++; S.exportando = "Baixando fotos " + feitas + " de " + total; render();
        }
      }
      var ordem = 0;
      lista.forEach(function (r) {
        if (r._arq) ordem++;
        linhas.push([pasta, r._arq ? ordem : "", r._arq || "", r.dia, hora(r.ts), r.local, r.legenda, r.entra ? "sim" : "nao", obra.id].map(csvCel).join(";"));
      });
    }
    zip.file("registros.csv", "﻿" + linhas.join("\r\n"));
    zip.file("obra.json", JSON.stringify(obra, null, 2));
    for (var q = 0; q < 2; q++) {
      var cam = q ? obra.imagem_mapa : obra.imagem_capa;
      if (!cam) continue;
      var u = await S.sb.storage.from("fotos").createSignedUrl(cam, 600);
      if (u.data) { try { zip.file("obra/" + (q ? "mapa" : "capa") + cam.slice(cam.lastIndexOf(".")), await (await fetch(u.data.signedUrl)).blob()); } catch (e) { /* segue */ } }
    }
    S.exportando = "Compactando..."; render();
    var blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    baixar(blob, "pacote_" + obra.id + "_" + de + "_a_" + ate + ".zip");
    S.exportando = "";
    S.msg = "Pacote baixado (" + total + " fotos no relatório)." + (pend ? " Atenção: " + pend + " foto(s) ainda pendente(s) de envio ficaram de fora." : "");
    render();
  }

  // ---------------------------------------------------------------- telas
  // ---------------------------------------------------------------- estrutura (menu lateral)
  var MENU = [
    { sec: "PRINCIPAL", itens: [{ id: "inicio", rot: "Início" }] },
    { sec: "VISTORIA", mod: "vistoria", itens: [{ id: "regs", rot: "Registros de campo" }, { id: "painel", rot: "Painel de vistorias" }, { id: "clientes", rot: "Clientes e obras" }] },
    { sec: "MANUAL", mod: "manual", itens: [{ id: "manual", rot: "Manual de uso", breve: 1 }, { id: "plano", rot: "Plano de manutenção", breve: 1 }, { id: "memorial", rot: "Memorial de acabamentos", breve: 1 }, { id: "asbuilt", rot: "As built", breve: 1 }] },
    { sec: "LAUDO", mod: "laudo", itens: [{ id: "laudo", rot: "Laudos", breve: 1 }] },
    { sec: "SISTEMA", itens: [{ id: "usuarios", rot: "Usuários", admin: 1 }, { id: "conta", rot: "Conta" }] }
  ];
  var ROTAS_OBRA = { regs: 1, painel: 1 };
  function temModulo(m) {
    if (!m || !S.perfil) return true;
    return S.perfil.papel === "admin" || (S.perfil.modulos || []).indexOf(m) >= 0;
  }
  function tituloDe(id) {
    var t = "";
    MENU.forEach(function (s) { s.itens.forEach(function (i) { if (i.id === id) t = i.rot; }); });
    return t;
  }
  function irPara(id) {
    S.aba = id; S.menuAberto = false; S.clienteSel = null; S.obraSel = null; S.msg = "";
    try { history.replaceState(null, "", "#/" + id); } catch (e) { /* ignora */ }
    render(); window.scrollTo(0, 0);
  }
  function lateral() {
    var blocos = [];
    MENU.forEach(function (sec) {
      if (!temModulo(sec.mod)) return;
      var itens = sec.itens.filter(function (i) { return !i.admin || ehAdmin(); });
      if (!itens.length) return;
      blocos.push(h("div", { class: "sec" }, sec.sec));
      itens.forEach(function (i) {
        blocos.push(h("button", { class: "item" + (S.aba === i.id ? " at" : ""), onclick: function () { irPara(i.id); } }, i.rot, i.breve ? h("span", { class: "breve" }, "em breve") : null));
      });
    });
    return h("aside", { class: "lateral" + (S.menuAberto ? " aberta" : "") },
      h("div", { class: "logo" }, "STUDIUM", h("small", {}, "Soluções em Engenharia")),
      h("div", { class: "itens" }, blocos),
      h("div", { class: "usuario" }, S.user ? S.user.email : "", h("br"), h("small", {}, S.perfil ? S.perfil.papel : "")));
  }
  function cabecalho() {
    var pend = S.fila.length, comObra = ROTAS_OBRA[S.aba];
    return h("header", {},
      h("button", { class: "hamb", "aria-label": "Menu", onclick: function () { S.menuAberto = !S.menuAberto; render(); } }, "☰"),
      h("strong", { class: "tit" + (comObra ? " curto" : "") }, tituloDe(S.aba)),
      comObra ? h("select", {
        "aria-label": "Obra", onchange: function (e) { S.obraId = e.target.value; guardado("obra", S.obraId); render(); }
      }, S.obras.filter(function (o) { return o.ativa !== false || o.id === S.obraId; }).map(function (o) { return h("option", { value: o.id, selected: o.id === S.obraId ? "" : null }, o.nome_exibicao); })) : h("span", { class: "esp" }),
      h("span", { class: "pill " + (S.online ? "on" : "off") }, (S.online ? "Online" : "Offline") + (pend ? " · " + pend + " a enviar" : "")));
  }
  function navegacao() {
    var abas = [];
    if (temModulo("vistoria")) abas.push(["regs", "Registros"], ["painel", "Painel"]); else abas.push(["inicio", "Início"]);
    var nav = h("nav", {}, abas.map(function (a) {
      return h("button", { class: S.aba === a[0] ? "at" : "", onclick: function () { irPara(a[0]); } }, a[1]);
    }));
    nav.append(h("button", { class: S.menuAberto ? "at" : "", onclick: function () { S.menuAberto = !S.menuAberto; render(); } }, "Menu"));
    return nav;
  }

  function cartaoRegistro(it) {
    var mini = it._pend ? null : S.minis.get(it.id);
    var url = it._pend ? (it._u = it._u || URL.createObjectURL(it.thumb)) : mini;
    var tag = it._pend ? (it.estado === "falha" ? h("span", { class: "tag fal", title: it.erro || "" }, "Falha") : h("span", { class: "tag pen" }, it.estado === "enviando" ? "Enviando..." : "A enviar")) : h("span", { class: "tag env" }, "Enviada");
    var cont = h("div", { class: "cont" }, (it.legenda || "").length + "/" + LIMITE_LEGENDA);
    var ta = h("textarea", {
      placeholder: "Legenda (toque no microfone do teclado para ditar)", maxlength: 400, value: it.legenda || "",
      oninput: function (e) {
        var n = e.target.value.length; cont.textContent = n + "/" + LIMITE_LEGENDA; cont.className = "cont" + (n > LIMITE_LEGENDA ? " ex" : "");
        clearTimeout(ta._t); ta._t = setTimeout(function () { editarCampo(it, "legenda", e.target.value); }, 500);
      },
      onblur: function (e) { clearTimeout(ta._t); editarCampo(it, "legenda", e.target.value); }
    });
    var chave = "rm" + it.id;
    return h("div", { class: "cartao reg" },
      url ? h("img", { class: "mini", src: url, alt: "Foto", onclick: function () { abrirVisor(it); } }) : h("div", { class: "mini", onclick: function () { abrirVisor(it); } }, "foto"),
      h("div", {},
        h("div", { class: "meta" }, hora(it.ts), tag, it.estado === "falha" && it.erro ? h("span", { class: "erro" }, it.erro) : null),
        h("input", {
          type: "text", placeholder: "Local (ex.: torre B, 3º pavimento)", value: it.local || "", "aria-label": "Local",
          onchange: function (e) { editarCampo(it, "local", e.target.value); guardado("local", e.target.value); }
        }),
        ta, cont,
        h("div", { class: "rod" },
          h("label", { class: "chk" }, h("input", { type: "checkbox", checked: it.entra !== false, onchange: function (e) { editarCampo(it, "entra", e.target.checked); } }), "Entra no relatório"),
          (it._pend || ehAdmin()) ? h("button", { class: "bt sec pe perigo", onclick: function () { confirmar(chave, function () { remover(it); }); } }, S.confirmar === chave ? "Confirmar?" : "Remover") : null)));
  }

  function telaRegistros() {
    var itens = itensDaObra(), semanas = {};
    itens.forEach(function (it) { ((semanas[it.semana] = semanas[it.semana] || {})[it.dia] = semanas[it.semana][it.dia] || []).push(it); });
    var blocos = [];
    Object.keys(semanas).sort().reverse().forEach(function (seg) {
      blocos.push(h("div", { class: "semana" }, h("span", {}, rotuloSemana(seg)),
        h("button", { onclick: function () { exportar(seg, diaDe(new Date(sexta(seg).getTime() + 2 * 86400000))); }, disabled: !!S.exportando }, "Exportar semana")));
      Object.keys(semanas[seg]).sort().reverse().forEach(function (dia) {
        blocos.push(h("div", { class: "dia" }, rotuloDia(dia) + " (" + semanas[seg][dia].length + ")"));
        semanas[seg][dia].forEach(function (it) { blocos.push(cartaoRegistro(it)); });
      });
    });
    var cam = h("input", { type: "file", accept: "image/*", capture: "environment", multiple: true, hidden: true, onchange: aoCapturar });
    var gal = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: aoCapturar });
    return h("main", {},
      S.msg ? h("div", { class: "aviso" }, S.msg) : null,
      h("div", { class: "linha" },
        h("button", { class: "bt", onclick: function () { cam.click(); } }, "Tirar foto"),
        h("button", { class: "bt sec", onclick: function () { gal.click(); } }, "Da galeria")),
      cam, gal,
      h("div", { class: "linha", style: "margin-top:8px" },
        h("button", { class: "bt sec pe", disabled: S.sincronizando || !S.fila.length, onclick: function () { sincronizar(true); } },
          S.sincronizando ? "Enviando..." : (S.fila.length ? "Enviar agora (" + S.fila.length + ")" : "Tudo enviado"))),
      itens.length ? blocos : h("p", { class: "mut" }, S.carregou || S.fila.length ? "Nenhuma foto nesta obra ainda." : "Aguardando carregar os dados da obra..."));
  }

  function telaPainel() {
    var obra = obraAtual(), itens = itensDaObra(), porDia = {};
    itens.forEach(function (it) { var d = porDia[it.dia] = porDia[it.dia] || { n: 0, e: 0, p: {} }; d.n++; if (it.entra !== false) d.e++; if (it.autor) d.p[it.autor] = 1; });
    var dias = Object.keys(porDia).sort();
    var ano = S.mes.getFullYear(), mes = S.mes.getMonth(), ini = new Date(ano, mes, 1), nDias = new Date(ano, mes + 1, 0).getDate();
    var hoje = diaDe(new Date()), celulas = [];
    ["S", "T", "Q", "Q", "S", "S", "D"].forEach(function (x) { celulas.push(h("div", { class: "cab" }, x)); });
    for (var v = 0; v < (ini.getDay() + 6) % 7; v++) celulas.push(h("div", { class: "d vz" }));
    for (var d = 1; d <= nDias; d++) {
      (function (dd) {
        var chave = ano + "-" + pad(mes + 1) + "-" + pad(dd), info = porDia[chave];
        celulas.push(h("div", { class: "d" + (info ? " tem" : "") + (chave === hoje ? " hoje" : ""), onclick: function () { S.diaSel = info ? chave : null; render(); } },
          String(dd), info ? h("small", {}, info.n + " fotos") : null));
      })(d);
    }
    var sel = S.diaSel && porDia[S.diaSel];
    var total = S.regs.length + S.fila.length, usado = total * MB_POR_FOTO, pct = Math.min(100, Math.round(usado / 1024 * 100));
    var hojeD = new Date(), de = diaDe(new Date(hojeD.getFullYear(), hojeD.getMonth(), 1)), ate = hoje;
    var iDe = h("input", { type: "date", value: de }), iAte = h("input", { type: "date", value: ate });
    return h("main", {},
      S.msg ? h("div", { class: "aviso" }, S.msg) : null,
      h("h2", {}, obra ? obra.nome_exibicao : "Obra"),
      h("div", { class: "grade" },
        h("div", { class: "cartao" }, h("div", { class: "num" }, String(dias.length)), h("div", { class: "mut" }, "dias de vistoria")),
        h("div", { class: "cartao" }, h("div", { class: "num" }, String(itens.length)), h("div", { class: "mut" }, "fotos registradas")),
        h("div", { class: "cartao" }, h("div", { class: "num" }, dias.length ? ddmm(parseDia(dias[dias.length - 1])) : "-"), h("div", { class: "mut" }, "última vistoria")),
        h("div", { class: "cartao" }, h("div", { class: "num" }, String(S.fila.length)), h("div", { class: "mut" }, "pendentes de envio (todas as obras)"))),
      h("div", { class: "cartao" },
        h("div", { class: "linha" },
          h("button", { class: "bt sec pe", onclick: function () { S.mes = new Date(ano, mes - 1, 1); render(); } }, "‹"),
          h("strong", { style: "text-align:center;text-transform:capitalize" }, MESES[mes] + " " + ano),
          h("button", { class: "bt sec pe", onclick: function () { S.mes = new Date(ano, mes + 1, 1); render(); } }, "›")),
        h("div", { class: "cal", style: "margin-top:10px" }, celulas),
        sel ? h("p", { class: "mut" }, rotuloDia(S.diaSel) + ": " + sel.n + " fotos (" + sel.e + " no relatório)" + (Object.keys(sel.p).length ? ", " + Object.keys(sel.p).length + " pessoa(s)" : "")) : h("p", { class: "mut" }, "Dias em laranja têm vistoria registrada. Toque em um dia para ver o resumo.")),
      h("div", { class: "cartao" },
        h("h2", {}, "Exportar para o relatório"),
        h("p", { class: "mut" }, "Gera um arquivo .zip com as fotos que entram no relatório, separadas por semana, e a planilha de legendas. Só inclui fotos já enviadas."),
        h("div", { class: "linha" }, h("div", { class: "campo" }, h("label", {}, "De"), iDe), h("div", { class: "campo" }, h("label", {}, "Até"), iAte)),
        h("button", { class: "bt", disabled: !!S.exportando || !S.online, onclick: function () { exportar(iDe.value, iAte.value); } }, S.exportando || "Baixar pacote (.zip)")),
      h("div", { class: "cartao" },
        h("h2", {}, "Armazenamento (plano gratuito)"),
        h("div", { style: "height:10px;border-radius:99px;background:var(--line);overflow:hidden" }, h("div", { style: "height:100%;width:" + pct + "%;background:var(--acc)" })),
        h("p", { class: "mut" }, total + " fotos, cerca de " + Math.round(usado) + " MB de 1024 MB (estimativa). Depois de gerar o relatório do mês, baixe o pacote, guarde no Drive e peça para a administradora apagar as fotos antigas.")));
  }

  // ---------------------------------------------------------------- início (dashboard geral)
  var LIMITE_DIAS = { semanal: 7, quinzenal: 15, mensal: 31 };
  function telaInicio() {
    var hoje = new Date(), hojeStr = diaDe(hoje), mesIni = diaDe(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    var ativas = S.obras.filter(function (o) { return o.ativa !== false; }), linhas = [], diasMes = {};
    ativas.forEach(function (o) {
      var regs = S.regs.filter(function (r) { return r.obra_id === o.id; }), dias = {};
      regs.forEach(function (r) { dias[r.dia] = 1; if (r.dia >= mesIni) diasMes[o.id + r.dia] = 1; });
      var ult = Object.keys(dias).sort().pop(), sem = ult ? Math.floor((parseDia(hojeStr) - parseDia(ult)) / 86400000) : null;
      var lim = LIMITE_DIAS[o.periodicidade], estado = "ok", txt = "Em dia";
      if (!ult) { estado = "fal"; txt = "Sem registros"; }
      else if (lim && sem > lim) { estado = "fal"; txt = "Atrasada"; }
      else if (lim && sem > lim * 0.8) { estado = "pen"; txt = "Atenção"; }
      else if (!lim) { estado = "pen"; txt = "Sem periodicidade"; }
      var cli = S.clientes.find(function (c) { return c.id === o.cliente_id; });
      linhas.push({ o: o, cli: cli ? cli.razao_social : (o.cliente || "-"), ult: ult, sem: sem, fotos: regs.length, estado: estado, txt: txt });
    });
    linhas.sort(function (a, b) { var p = { fal: 0, pen: 1, ok: 2 }; return p[a.estado] - p[b.estado] || (b.sem || 0) - (a.sem || 0); });
    var emDia = linhas.filter(function (l) { return l.estado === "ok"; }).length, atras = linhas.filter(function (l) { return l.estado === "fal"; }).length;
    var cards = [];
    if (temModulo("vistoria")) {
      cards.push(
        h("div", { class: "grade g4" },
          h("div", { class: "cartao" }, h("div", { class: "num" }, String(ativas.length)), h("div", { class: "mut" }, "obras ativas")),
          h("div", { class: "cartao" }, h("div", { class: "num" }, String(Object.keys(diasMes).length)), h("div", { class: "mut" }, "vistorias no mês (obra x dia)")),
          h("div", { class: "cartao" }, h("div", { class: "num", style: atras ? "color:var(--err)" : "" }, String(atras)), h("div", { class: "mut" }, "obras atrasadas ou sem registro")),
          h("div", { class: "cartao" }, h("div", { class: "num" }, String(S.fila.length)), h("div", { class: "mut" }, "fotos pendentes de envio"))),
        h("div", { class: "cartao" },
          h("h2", {}, "Situação das obras"),
          linhas.length ? h("div", { class: "tabela" },
            h("div", { class: "tr th" }, h("span", {}, "Obra"), h("span", {}, "Última vistoria"), h("span", {}, "Fotos"), h("span", {}, "Situação")),
            linhas.map(function (l) {
              return h("div", { class: "tr", onclick: function () { S.obraId = l.o.id; guardado("obra", l.o.id); irPara("painel"); } },
                h("span", {}, h("strong", {}, l.o.nome_exibicao), h("br"), h("small", { class: "mut" }, l.cli + (l.o.periodicidade ? " | " + l.o.periodicidade : ""))),
                h("span", {}, l.ult ? ddmm(parseDia(l.ult)) + " (" + l.sem + " d)" : "-"),
                h("span", {}, String(l.fotos)),
                h("span", {}, h("span", { class: "tag " + (l.estado === "ok" ? "env" : l.estado === "pen" ? "pen" : "fal") }, l.txt)));
            })) : h("p", { class: "mut" }, "Nenhuma obra ativa. Cadastre em Vistoria, Clientes e obras."),
          h("p", { class: "mut" }, "O alerta usa a periodicidade cadastrada em cada obra (semanal, quinzenal ou mensal). Obras sem periodicidade ficam em atenção."),
          emDia ? null : null));
    }
    var breves = [];
    MENU.forEach(function (s) {
      if (s.sec === "MANUAL" || s.sec === "LAUDO") if (temModulo(s.mod)) breves.push(h("div", { class: "cartao" }, h("h2", {}, s.sec), h("p", { class: "mut" }, s.itens.map(function (i) { return i.rot; }).join(", ")), h("span", { class: "tag pen" }, "em desenvolvimento")));
    });
    return h("main", {}, S.msg ? h("div", { class: "aviso" }, S.msg) : null, cards, breves.length ? h("div", { class: "grade g3" }, breves) : null);
  }
  function telaEmBreve(id) {
    return h("main", {}, h("div", { class: "cartao" }, h("h2", {}, tituloDe(id)),
      h("p", {}, "Módulo em definição. Ele será desenvolvido depois que a metodologia e o modelo de documento forem fornecidos pela engenharia."),
      h("p", { class: "mut" }, "A estrutura de acesso, o login e o banco de dados já estão prontos e serão reaproveitados.")));
  }

  // ---------------------------------------------------------------- clientes e obras
  var DEF_CLIENTE = [
    ["razao_social", "Razão social", "text", 1], ["documento", "CNPJ ou CPF", "text"], ["contato_nome", "Contato (nome)", "text"],
    ["contato_email", "E-mail do contato", "email"], ["contato_telefone", "Telefone do contato", "text"]
  ];
  var DEF_OBRA = [
    ["nome_exibicao", "Nome da obra na capa (ex.: COLISEU RESIDENCE)", "text", 1], ["nome_no_texto", "Nome da obra nas frases (ex.: Coliseu Residence)", "text", 1],
    ["titulo_relatorio", "Título do relatório", "text", 1], ["localizacao", "Endereço completo da obra", "textarea", 1],
    ["cidade_assinatura", "Cidade de assinatura", "text"], ["numero_contrato", "Número do contrato", "text"],
    ["escopo", "Escopo contratado", "textarea"], ["periodicidade", "Periodicidade das vistorias", "select", 0, ["semanal", "quinzenal", "mensal", "sob demanda"]],
    ["objetivo", "Objetivo da vistoria (item 1 do relatório)", "textarea"], ["legenda_mapa", "Legenda do mapa (Figura 1)", "text"],
    ["texto_item3", "Texto de abertura do item 3 ({nome_no_texto} é substituído)", "textarea"]
  ];
  function slug(t) { return (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "obra"; }
  function campoForm(def, valor) {
    var el;
    if (def[2] === "textarea") { el = h("textarea", { rows: 3 }); el.value = valor || ""; }
    else if (def[2] === "select") {
      el = h("select", {}, [h("option", { value: "" }, "Selecione")].concat(def[4].map(function (o) { return h("option", { value: o }, o); })));
      el.value = valor || "";
    } else { el = h("input", { type: def[2] || "text" }); el.value = valor || ""; }
    el.setAttribute("data-f", def[0]);
    return { el: el, bloco: h("div", { class: "campo" }, h("label", {}, def[1] + (def[3] ? " *" : "")), el) };
  }
  function montarForm(defs, valores) {
    var m = {}, blocos = defs.map(function (d) { var c = campoForm(d, valores[d[0]]); m[d[0]] = c.el; return c.bloco; });
    return { blocos: blocos, ler: function () { var r = {}; defs.forEach(function (d) { r[d[0]] = m[d[0]].value.trim(); }); return r; } };
  }
  async function enviarArquivo(file, caminho) {
    await S.sb.storage.from("fotos").remove([caminho]);
    var r = await S.sb.storage.from("fotos").upload(caminho, file, { contentType: file.type, upsert: false });
    if (r.error) throw r.error;
    return caminho;
  }
  function extDe(file) { return file.type === "image/png" ? ".png" : ".jpg"; }
  async function carregarLogos() {
    var caminhos = S.clientes.filter(function (c) { return c.logo_path && !S.logos[c.logo_path]; }).map(function (c) { return c.logo_path; });
    if (!caminhos.length || !S.online || !S.sb) return;
    var r = await S.sb.storage.from("fotos").createSignedUrls(caminhos, 3600);
    if (r.data) r.data.forEach(function (x) { if (x.signedUrl) S.logos[x.path] = x.signedUrl; });
  }
  function exigeOnline() {
    if (S.online) return false;
    S.msg = "Cadastros precisam de internet. Conecte-se e tente novamente."; render(); return true;
  }

  function telaClientes() {
    if (S.obraSel) return telaObra();
    if (S.clienteSel) return telaCliente();
    var lista = S.clientes.slice().sort(function (a, b) { return a.razao_social.localeCompare(b.razao_social); });
    return h("main", {},
      S.msg ? h("div", { class: "aviso" }, S.msg) : null,
      h("div", { class: "linha" }, h("h2", {}, "Clientes de vistoria"), h("button", { class: "bt pe", style: "flex:0 0 auto", onclick: function () { S.clienteSel = "novo"; S.msg = ""; render(); } }, "Novo cliente")),
      lista.length ? lista.map(function (c) {
        var obras = S.obras.filter(function (o) { return o.cliente_id === c.id; });
        return h("div", { class: "cartao cli", onclick: function () { S.clienteSel = c.id; S.msg = ""; render(); } },
          S.logos[c.logo_path] ? h("img", { class: "logo-c", src: S.logos[c.logo_path], alt: "" }) : h("div", { class: "logo-c ini" }, c.razao_social.slice(0, 1)),
          h("div", {}, h("strong", {}, c.razao_social), h("div", { class: "mut" }, [c.documento, c.contato_nome].filter(Boolean).join(" | ")),
            h("div", { class: "mut" }, obras.length + (obras.length === 1 ? " obra" : " obras") + (obras.length ? ": " + obras.map(function (o) { return o.nome_exibicao; }).join(", ") : ""))));
      }) : h("p", { class: "mut" }, "Nenhum cliente cadastrado."));
  }

  function telaCliente() {
    var novo = S.clienteSel === "novo", c = novo ? {} : (S.clientes.find(function (x) { return x.id === S.clienteSel; }) || {});
    var form = montarForm(DEF_CLIENTE, c), logo = h("input", { type: "file", accept: "image/png,image/jpeg" });
    async function salvar() {
      if (exigeOnline()) return;
      var reg = form.ler();
      if (!reg.razao_social) { S.msg = "Informe a razão social."; render(); return; }
      try {
        var id = novo ? novoId() : c.id;
        var r = novo ? await S.sb.from("clientes").insert(Object.assign({ id: id }, reg)) : await S.sb.from("clientes").update(reg).eq("id", id);
        if (r.error) throw r.error;
        if (logo.files[0]) {
          var cam = await enviarArquivo(logo.files[0], "clientes/" + id + "/logo" + extDe(logo.files[0]));
          var u = await S.sb.from("clientes").update({ logo_path: cam }).eq("id", id);
          if (u.error) throw u.error;
        }
        if (!novo) await S.sb.from("obras").update({ cliente: reg.razao_social.toUpperCase() }).eq("cliente_id", id);
        S.clienteSel = id; S.msg = "Cliente salvo.";
        await carregarNuvem(); await carregarLogos();
      } catch (e) { S.msg = "Erro ao salvar: " + msgErro(e); }
      render();
    }
    var obras = novo ? [] : S.obras.filter(function (o) { return o.cliente_id === c.id; });
    return h("main", {},
      S.msg ? h("div", { class: "aviso" }, S.msg) : null,
      h("button", { class: "bt sec pe", onclick: function () { S.clienteSel = null; S.msg = ""; render(); } }, "‹ Voltar aos clientes"),
      h("div", { class: "cartao" },
        h("h2", {}, novo ? "Novo cliente" : "Cliente"),
        form.blocos,
        h("div", { class: "campo" }, h("label", {}, "Logo do cliente (PNG ou JPG, opcional" + (c.logo_path ? "; já enviada, escolha outra para trocar" : "") + ")"), logo),
        S.logos[c.logo_path] ? h("img", { class: "logo-prev", src: S.logos[c.logo_path], alt: "Logo" }) : null,
        h("button", { class: "bt", onclick: salvar }, "Salvar cliente")),
      novo ? h("p", { class: "mut" }, "Salve o cliente para cadastrar as obras dele.") : h("div", { class: "cartao" },
        h("div", { class: "linha" }, h("h2", {}, "Obras deste cliente"), h("button", { class: "bt pe", style: "flex:0 0 auto", onclick: function () { S.obraSel = "nova"; S.msg = ""; render(); } }, "Nova obra")),
        obras.length ? obras.map(function (o) {
          return h("div", { class: "cli", onclick: function () { S.obraSel = o.id; S.msg = ""; render(); } },
            h("div", {}, h("strong", {}, o.nome_exibicao), h("div", { class: "mut" }, [o.numero_contrato ? "Contrato " + o.numero_contrato : "", o.periodicidade, o.ativa === false ? "inativa" : ""].filter(Boolean).join(" | "))));
        }) : h("p", { class: "mut" }, "Nenhuma obra cadastrada para este cliente.")));
  }

  function telaObra() {
    var novo = S.obraSel === "nova", cli = S.clientes.find(function (x) { return x.id === S.clienteSel; }) || {};
    var o = novo ? { titulo_relatorio: "RELATÓRIO DE FISCALIZAÇÃO DE OBRA", legenda_mapa: "Figura 1: Localização da edificação objeto da vistoria.", cidade_assinatura: "", ativa: true,
      texto_item3: "O presente relatório tem por objetivo acompanhar e documentar, por meio de inspeção visual e registro fotográfico, os serviços em execução no {nome_no_texto}, ", objetivo: "Fiscalização da obra." } : (S.obras.find(function (x) { return x.id === S.obraSel; }) || {});
    var form = montarForm(DEF_OBRA, o), capa = h("input", { type: "file", accept: "image/jpeg,image/png" }), mapa = h("input", { type: "file", accept: "image/jpeg,image/png" });
    var ativa = h("input", { type: "checkbox", "data-f": "ativa" }); ativa.checked = o.ativa !== false;
    async function salvar() {
      if (exigeOnline()) return;
      var reg = form.ler();
      if (!reg.nome_exibicao || !reg.nome_no_texto || !reg.titulo_relatorio || !reg.localizacao) { S.msg = "Preencha os campos obrigatórios (*)."; render(); return; }
      reg.numero_contrato = reg.numero_contrato || null; reg.escopo = reg.escopo || null; reg.periodicidade = reg.periodicidade || null;
      reg.ativa = ativa.checked; reg.cliente_id = cli.id; reg.cliente = (cli.razao_social || "").toUpperCase();
      reg.cidade_assinatura = reg.cidade_assinatura || "";
      try {
        var id = o.id;
        if (novo) { id = slug(reg.nome_exibicao); var base = id, n = 2; while (S.obras.some(function (x) { return x.id === id; })) id = base + "-" + (n++); }
        reg.id = id;
        if (capa.files[0]) reg.imagem_capa = await enviarArquivo(capa.files[0], "obras/" + id + "/capa" + extDe(capa.files[0]));
        if (mapa.files[0]) reg.imagem_mapa = await enviarArquivo(mapa.files[0], "obras/" + id + "/mapa" + extDe(mapa.files[0]));
        var r = novo ? await S.sb.from("obras").insert(reg) : await S.sb.from("obras").update(reg).eq("id", id);
        if (r.error) throw r.error;
        S.obraSel = id; S.obraId = id; guardado("obra", id); S.msg = "Obra salva.";
        await carregarNuvem();
      } catch (e) { S.msg = "Erro ao salvar: " + msgErro(e); }
      render();
    }
    return h("main", {},
      S.msg ? h("div", { class: "aviso" }, S.msg) : null,
      h("button", { class: "bt sec pe", onclick: function () { S.obraSel = null; S.msg = ""; render(); } }, "‹ Voltar ao cliente"),
      h("div", { class: "cartao" },
        h("h2", {}, (novo ? "Nova obra" : "Obra") + " | " + (cli.razao_social || "")),
        form.blocos,
        h("div", { class: "campo" }, h("label", { class: "chk" }, ativa, "Obra ativa (aparece no app de campo e no painel)")),
        h("div", { class: "campo" }, h("label", {}, "Imagem de capa do relatório (opcional; atual: " + (o.imagem_capa ? "enviada" : "padrão") + ")"), capa),
        h("div", { class: "campo" }, h("label", {}, "Mapa de localização, Figura 1 (atual: " + (o.imagem_mapa ? "enviado" : "nenhum") + ")"), mapa),
        h("button", { class: "bt", onclick: salvar }, "Salvar obra")));
  }

  // ---------------------------------------------------------------- usuários
  function telaUsuarios() {
    var MODS = [["vistoria", "Vistoria"], ["manual", "Manual"], ["laudo", "Laudo"]];
    var linhas = S.perfis.slice().sort(function (a, b) { return (a.email || "").localeCompare(b.email || ""); }).map(function (p) {
      var eu = S.user && p.user_id === S.user.id;
      var nome = h("input", { type: "text", placeholder: "Nome" }); nome.value = p.nome || "";
      var papel = h("select", {}, h("option", { value: "equipe" }, "Equipe"), h("option", { value: "admin" }, "Administradora")); papel.value = p.papel;
      var ativo = h("input", { type: "checkbox" }); ativo.checked = p.ativo !== false;
      if (eu) { papel.setAttribute("disabled", ""); ativo.setAttribute("disabled", ""); }
      var mods = MODS.map(function (m) { var c = h("input", { type: "checkbox" }); c.checked = (p.modulos || []).indexOf(m[0]) >= 0; c._m = m[0]; return c; });
      return h("div", { class: "cartao" },
        h("strong", {}, p.email || p.user_id), eu ? h("span", { class: "mut" }, " (você)") : null,
        h("div", { class: "campo" }, h("label", {}, "Nome"), nome),
        h("div", { class: "linha" }, h("div", { class: "campo" }, h("label", {}, "Perfil"), papel), h("label", { class: "chk" }, ativo, "Acesso ativo")),
        h("div", { class: "chk-linha" }, mods.map(function (c, i) { return h("label", { class: "chk" }, c, MODS[i][1]); })),
        h("p", { class: "mut" }, "Administradora vê todos os módulos. Para equipe, marque os módulos liberados."),
        h("button", { class: "bt pe", onclick: async function () {
          if (exigeOnline()) return;
          var r = await S.sb.from("perfis").update({ nome: nome.value.trim() || null, papel: papel.value, ativo: ativo.checked, modulos: mods.filter(function (c) { return c.checked; }).map(function (c) { return c._m; }) }).eq("user_id", p.user_id);
          S.msg = r.error ? "Erro ao salvar: " + msgErro(r.error) : "Usuário atualizado.";
          await carregarNuvem(); render();
        } }, "Salvar"));
    });
    return h("main", {}, S.msg ? h("div", { class: "aviso" }, S.msg) : null,
      h("div", { class: "aviso" }, "Para incluir uma pessoa nova: no Supabase, Authentication, Users, Add user (com Auto Confirm). Ela aparece aqui automaticamente, e você define o perfil e os módulos."),
      linhas);
  }

  function telaConta() {
    return h("main", {},
      S.msg ? h("div", { class: "aviso" }, S.msg) : null,
      h("div", { class: "cartao" },
        h("h2", {}, "Conta"),
        h("p", {}, S.user ? S.user.email : "-"), h("p", { class: "mut" }, "Perfil: " + (S.perfil ? S.perfil.papel : "-") + " | Versão " + CFG.VERSAO),
        h("button", { class: "bt sec", onclick: function () { sincronizar(true); } }, "Sincronizar agora"),
        h("p", {}),
        h("button", { class: "bt sec perigo", onclick: function () {
          if (S.fila.length && S.confirmar !== "sair") { S.msg = "Há " + S.fila.length + " foto(s) não enviada(s). Sair não apaga, mas só envie de novo após entrar. Toque novamente para sair."; confirmar("sair", sair); return; }
          sair();
        } }, "Sair")),
      h("div", { class: "aviso" }, "Dica: abra o app com internet antes de ir a campo, tire as fotos normalmente e, ao voltar a ter sinal, ele envia sozinho. Confira o contador de pendentes no topo."));
  }
  async function sair() { await S.sb.auth.signOut(); S.user = null; S.precisaLogin = true; S.confirmar = null; render(); }

  function telaLogin() {
    var em = h("input", { type: "email", autocomplete: "username", placeholder: "e-mail" }), sn = h("input", { type: "password", autocomplete: "current-password", placeholder: "senha" });
    var er = h("div", { class: "erro" });
    async function entrar() {
      er.textContent = "";
      if (!navigator.onLine) { er.textContent = "Para entrar pela primeira vez é preciso estar online."; return; }
      var r = await S.sb.auth.signInWithPassword({ email: em.value.trim(), password: sn.value });
      if (r.error) { er.textContent = /invalid/i.test(r.error.message) ? "E-mail ou senha incorretos." : msgErro(r.error); return; }
      S.user = r.data.user; S.precisaLogin = false; await iniciar();
    }
    return h("div", { class: "centro" },
      h("h1", { style: "letter-spacing:.14em;font-size:16px;color:var(--cinza)" }, "STUDIUM"), h("h2", {}, "Vistoria em campo"),
      h("div", { class: "campo" }, h("label", {}, "E-mail"), em), h("div", { class: "campo" }, h("label", {}, "Senha"), sn),
      er, h("button", { class: "bt", style: "width:100%", onclick: entrar }, "Entrar"));
  }

  function render() {
    var a = document.activeElement;
    if (a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName) && app.contains(a) && a.type !== "checkbox" && a.type !== "file") { pendRender = true; return; }
    pendRender = false;
    var y = window.scrollY, tela, sig = S.aba + "|" + S.clienteSel + "|" + S.obraSel, rasc = null;
    if (sig === S.sigAnt) {                       // mesma tela: não perde o que foi digitado
      rasc = {};
      app.querySelectorAll("[data-f]").forEach(function (e) { rasc[e.getAttribute("data-f")] = e.type === "checkbox" ? e.checked : e.value; });
    }
    S.sigAnt = sig;
    if (S.precisaLogin || !S.user) { app.replaceChildren(telaLogin()); return; }
    var id = S.aba;
    if (id === "inicio") tela = telaInicio();
    else if (id === "painel" && temModulo("vistoria")) tela = telaPainel();
    else if (id === "regs" && temModulo("vistoria")) tela = telaRegistros();
    else if (id === "clientes" && temModulo("vistoria")) tela = telaClientes();
    else if (id === "usuarios" && ehAdmin()) tela = telaUsuarios();
    else if (id === "conta") tela = telaConta();
    else if (MENU.some(function (s) { return s.itens.some(function (i) { return i.id === id && i.breve; }) && temModulo(s.mod); })) tela = telaEmBreve(id);
    else tela = telaInicio();
    app.replaceChildren(h("div", { class: "shell" }, lateral(),
      h("div", { class: "vel" + (S.menuAberto ? " on" : ""), onclick: function () { S.menuAberto = false; render(); } }),
      h("div", { class: "conteudo" }, cabecalho(), tela, navegacao())));
    window.scrollTo(0, y);
  }
    document.addEventListener("focusout", function () { setTimeout(function () { if (pendRender) render(); }, 150); });

  // ---------------------------------------------------------------- início
  async function iniciar() {
    await carregarLocal();
    var hsh = (location.hash || "").replace("#/", "");
    if (hsh && tituloDe(hsh)) S.aba = hsh;
    render();
    if (S.online) { await carregarNuvem(); sincronizar(); assinar(); }
  }
  function assinar() {
    if (S.canal || !S.sb) return;
    S.canal = S.sb.channel("regs").on("postgres_changes", { event: "*", schema: "public", table: "registros" }, function () {
      clearTimeout(timerRefresh); timerRefresh = setTimeout(carregarNuvem, 1500);
    }).subscribe();
  }

  async function main() {
    if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("sw.js"); } catch (e) { /* segue */ } }
    try { idb = await abrirIDB(); } catch (e) { app.textContent = "Este navegador não permite guardar dados offline. Abra no Chrome ou Safari, fora de abas anônimas."; return; }
    S.sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "studium-vistoria-auth" } });
    window.addEventListener("online", function () { S.online = true; render(); sincronizar(); });
    window.addEventListener("offline", function () { S.online = false; render(); });
    setInterval(function () { if (S.fila.length || S.edicoes && Object.keys(S.edicoes).length) sincronizar(); }, 45000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) sincronizar(); });

    var ses = null;
    try { ses = (await S.sb.auth.getSession()).data.session; } catch (e) { /* offline */ }
    if (ses) { S.user = ses.user; guardado("user", JSON.stringify({ id: ses.user.id, email: ses.user.email })); }
    else {
      var u = null; try { u = JSON.parse(guardado("user") || "null"); } catch (e) { /* ignora */ }
      if (u && !navigator.onLine) S.user = u;           // abriu sem internet: segue com o último usuário
      else { S.precisaLogin = true; render(); return; }
    }
    await iniciar();
  }
  main();
})();
