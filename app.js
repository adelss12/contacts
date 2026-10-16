"use strict";

/* =========================================================
   دليل أرقامي — الإصدار 2
   كل البيانات تُحفظ في متصفح المستخدم فقط (localStorage)
   ========================================================= */
(function () {
    const STORAGE_KEY = "dalilContacts"; // نفس المفتاح القديم حتى لا تضيع بيانات المستخدمين

    /* ---------- التخزين (مع بديل مؤقت إن كان التخزين محجوبًا) ---------- */
    const memoryStore = {};
    let storageWarned = false;

    const store = {
        get(key) {
            try { return localStorage.getItem(key); }
            catch (e) { return key in memoryStore ? memoryStore[key] : null; }
        },
        set(key, value) {
            try { localStorage.setItem(key, value); }
            catch (e) {
                memoryStore[key] = value;
                if (!storageWarned) {
                    storageWarned = true;
                    showToast("تعذّر الحفظ الدائم في هذا المتصفح، صدّر نسخة احتياطية.");
                }
            }
        }
    };

    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function loadContacts() {
        let list = [];
        try { list = JSON.parse(store.get(STORAGE_KEY) || "[]"); } catch (e) { list = []; }
        if (!Array.isArray(list)) list = [];
        if (list.length === 0 && Array.isArray(window.DALIL_DEMO)) list = window.DALIL_DEMO;

        return list
            .filter(c => c && typeof c.name === "string")
            .map(c => ({
                id: c.id || uid(),
                name: c.name,
                phones: Array.isArray(c.phones) ? c.phones.filter(Boolean).map(String) : []
            }));
    }

    let contacts = loadContacts();

    function saveContacts() {
        store.set(STORAGE_KEY, JSON.stringify(contacts));
    }

    /* ---------- توحيد النصوص والأرقام للبحث ومنع التكرار ---------- */
    function toLatinDigits(text) {
        return String(text)
            .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
            .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776));
    }

    // يجعل «أحمد» = «احمد» و«فاطمة» = «فاطمه» و«مصطفى» = «مصطفي»
    function normalizeText(text) {
        return toLatinDigits(text)
            .toLowerCase()
            .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
            .replace(/[أإآٱ]/g, "ا")
            .replace(/ة/g, "ه")
            .replace(/ى/g, "ي")
            .replace(/ؤ/g, "و")
            .replace(/ئ/g, "ي")
            .replace(/\s+/g, " ")
            .trim();
    }

    function phoneDigits(phone) {
        return toLatinDigits(phone).replace(/\D/g, "");
    }

    // مفتاح موحّد للرقم: 0501234567 و +966501234567 و 00966501234567 كلها رقم واحد
    function phoneKey(phone) {
        let d = phoneDigits(phone);
        if (d.startsWith("00")) d = d.slice(2);
        if (d.startsWith("966")) d = d.slice(3);
        if (d.startsWith("0")) d = d.slice(1);
        return d;
    }

    function uniquePhones(list) {
        const seen = new Set();
        return list
            .map(p => String(p).trim())
            .filter(p => {
                if (!p) return false;
                const key = phoneKey(p) || p;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    function telHref(phone) {
        return "tel:" + toLatinDigits(phone).replace(/[^\d+]/g, "");
    }

    // رابط واتساب يحتاج الصيغة الدولية؛ الأرقام المحلية تُعامل كأرقام سعودية
    function whatsappHref(phone) {
        let d = phoneDigits(phone);
        if (d.startsWith("00")) d = d.slice(2);
        else if (d.startsWith("05") && d.length === 10) d = "966" + d.slice(1);
        else if (d.startsWith("5") && d.length === 9) d = "966" + d;
        return d.length >= 8 ? "https://wa.me/" + d : null;
    }

    /* ---------- قراءة ملفات VCF ---------- */
    function decodeQuotedPrintable(text, charset) {
        const bytes = [];
        const encoder = new TextEncoder();
        for (let i = 0; i < text.length; i++) {
            const hex = text.substr(i + 1, 2);
            if (text[i] === "=" && /^[0-9A-F]{2}$/i.test(hex)) {
                bytes.push(parseInt(hex, 16));
                i += 2;
            } else {
                bytes.push(...encoder.encode(text[i]));
            }
        }
        const data = new Uint8Array(bytes);
        try { return new TextDecoder(charset || "utf-8").decode(data); }
        catch (e) { return new TextDecoder("utf-8").decode(data); }
    }

    function unescapeValue(value) {
        return value.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
    }

    function parseVCF(text) {
        const rawLines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
        const lines = [];

        // دمج الأسطر المطوية (تبدأ بمسافة) وأسطر Quoted-Printable المنتهية بـ «=»
        for (const line of rawLines) {
            const last = lines.length - 1;
            if (last >= 0 && /^[ \t]/.test(line)) {
                lines[last] += line.slice(1);
                continue;
            }
            if (last >= 0 && /=$/.test(lines[last]) &&
                /QUOTED-PRINTABLE/i.test(lines[last].split(":")[0])) {
                lines[last] = lines[last].slice(0, -1) + line.trim();
                continue;
            }
            lines.push(line);
        }

        const cards = [];
        let card = null;

        for (const line of lines) {
            const colon = line.indexOf(":");
            if (colon < 0) continue;

            const head = line.slice(0, colon);
            let value = line.slice(colon + 1);
            const parts = head.split(";");
            const prop = parts[0].toUpperCase().split(".").pop(); // item1.TEL → TEL
            const params = parts.slice(1).join(";").toUpperCase();

            if (prop === "BEGIN" && /^VCARD$/i.test(value.trim())) {
                card = { fn: "", n: null, org: "", tels: [] };
                continue;
            }
            if (prop === "END" && /^VCARD$/i.test(value.trim())) {
                if (card) cards.push(card);
                card = null;
                continue;
            }
            if (!card) continue;

            if (/QUOTED-PRINTABLE/.test(params)) {
                const charset = (params.match(/CHARSET=([^;]+)/) || [])[1];
                value = decodeQuotedPrintable(value, charset && charset.toLowerCase());
            } else if (/(^|;)(ENCODING=)?(B|BASE64)(;|$)/.test(params) &&
                (prop === "FN" || prop === "N" || prop === "ORG")) {
                try {
                    const bin = atob(value.trim());
                    value = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
                } catch (e) { /* نتركها كما هي */ }
            }

            if (prop === "FN") card.fn = unescapeValue(value).trim();
            else if (prop === "N") card.n = value.split(";").map(s => unescapeValue(s).trim());
            else if (prop === "ORG") card.org = unescapeValue(value.split(";")[0]).trim();
            else if (prop === "TEL") {
                const tel = value.replace(/^tel:/i, "").trim();
                if (tel) card.tels.push(tel);
            }
        }

        return cards.map(c => {
            let name = c.fn;
            if (!name && c.n) {
                const [family = "", given = "", middle = "", prefix = "", suffix = ""] = c.n;
                name = [prefix, given, middle, family, suffix].filter(Boolean).join(" ");
            }
            if (!name) name = c.org;
            if (!name) name = "بدون اسم";
            return { name: name.replace(/\s+/g, " ").trim(), phones: uniquePhones(c.tels) };
        });
    }

    async function readFileText(file) {
        const buffer = await file.arrayBuffer();
        let text = new TextDecoder("utf-8").decode(buffer);
        // ملفات الأجهزة القديمة قد تكون بترميز Windows-1256
        if (text.includes("\uFFFD")) {
            try { text = new TextDecoder("windows-1256").decode(buffer); } catch (e) { /* نُبقي UTF-8 */ }
        }
        return text;
    }

    // الدمج مع الموجود بدل الاستبدال، مع تجاهل المكرر
    function mergeContacts(incoming) {
        const byPhone = new Map();
        const byName = new Map();
        const index = c => {
            c.phones.forEach(p => { const k = phoneKey(p); if (k) byPhone.set(k, c); });
            byName.set(normalizeText(c.name), c);
        };
        contacts.forEach(index);

        let added = 0, updated = 0, skipped = 0;

        incoming.forEach(item => {
            let match = null;
            for (const p of item.phones) {
                const k = phoneKey(p);
                if (k && byPhone.has(k)) { match = byPhone.get(k); break; }
            }
            if (!match && item.phones.length === 0) {
                match = byName.get(normalizeText(item.name)) || null;
            }

            if (match) {
                const before = match.phones.length;
                match.phones = uniquePhones(match.phones.concat(item.phones));
                if (match.phones.length > before) updated++; else skipped++;
                index(match);
            } else {
                const contact = { id: uid(), name: item.name, phones: item.phones };
                contacts.push(contact);
                index(contact);
                added++;
            }
        });

        return { added, updated, skipped };
    }

    async function importFiles(fileList) {
        const files = [...fileList].filter(f => /\.vcf$/i.test(f.name) || /vcard/i.test(f.type));
        if (files.length === 0) {
            showToast("اختر ملفًا بصيغة VCF");
            return;
        }

        try {
            let incoming = [];
            for (const file of files) {
                incoming = incoming.concat(parseVCF(await readFileText(file)));
            }
            if (incoming.length === 0) {
                showToast("لم أجد أي جهة اتصال داخل الملف");
                return;
            }

            const before = JSON.stringify(contacts);
            const result = mergeContacts(incoming);
            sortContacts();
            saveContacts();
            render();

            const parts = [result.added ? `أسماء جديدة: ${result.added}` : "لا توجد أسماء جديدة"];
            if (result.updated) parts.push(`أُضيفت أرقام لـ ${result.updated}`);
            if (result.skipped) parts.push(`مكرر تم تجاهله: ${result.skipped}`);
            showToast(parts.join(" · "), () => restore(before));
        } catch (e) {
            console.error(e);
            showToast("تعذّرت قراءة الملف");
        }
    }

    /* ---------- الترتيب والعرض ---------- */
    const collator = new Intl.Collator("ar", { sensitivity: "base", numeric: true });

    function sortContacts() {
        contacts.sort((a, b) => collator.compare(a.name, b.name));
    }

    function groupLetter(name) {
        const ch = normalizeText(name).charAt(0);
        if (/[a-z]/.test(ch)) return ch.toUpperCase();
        if (/[\u0621-\u064A]/.test(ch)) return ch;
        return "#";
    }

    function avatarHue(name) {
        let h = 0;
        for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
        return h;
    }

    function buildQuery(raw) {
        const text = normalizeText(raw);
        const digits = phoneDigits(raw);
        return { raw: raw.trim(), text, digits, key: phoneKey(digits) };
    }

    function matches(contact, q) {
        if (!q.text) return true;
        if (normalizeText(contact.name).includes(q.text)) return true;
        if (q.digits.length >= 2) {
            return contact.phones.some(p =>
                phoneDigits(p).includes(q.digits) ||
                (q.key.length >= 2 && phoneKey(p).includes(q.key)));
        }
        return false;
    }

    const ICONS = {
        call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
        whatsapp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21l1.7-4.6A8.5 8.5 0 1 1 7.9 19.6z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.4-1.8-.9-.8.8a4 4 0 0 1-2-2l.8-.8-.9-1.8z"/></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
        edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>'
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function iconLink(href, icon, label, extraClass) {
        const a = el("a", "icon-btn" + (extraClass ? " " + extraClass : ""));
        a.href = href;
        a.innerHTML = ICONS[icon];
        a.setAttribute("aria-label", label);
        a.title = label;
        if (href.startsWith("http")) { a.target = "_blank"; a.rel = "noopener"; }
        return a;
    }

    function contactNode(contact) {
        const item = el("article", "contact-item");
        item.dataset.id = contact.id;

        const avatar = el("div", "avatar", (contact.name.trim().charAt(0) || "؟"));
        avatar.style.setProperty("--h", avatarHue(contact.name));
        avatar.setAttribute("aria-hidden", "true");

        const info = el("div", "contact-info");
        info.appendChild(el("h3", "", contact.name));

        if (contact.phones.length === 0) {
            info.appendChild(el("p", "no-phone", "لا يوجد رقم هاتف"));
        }

        contact.phones.forEach(phone => {
            const row = el("div", "phone-row");
            const num = el("bdi", "phone", phone);
            num.dir = "ltr";
            row.appendChild(num);
            row.appendChild(iconLink(telHref(phone), "call", "اتصال بـ " + phone));
            const wa = whatsappHref(phone);
            if (wa) row.appendChild(iconLink(wa, "whatsapp", "واتساب", "wa"));
            const copy = el("button", "icon-btn");
            copy.type = "button";
            copy.dataset.copy = phone;
            copy.innerHTML = ICONS.copy;
            copy.setAttribute("aria-label", "نسخ الرقم");
            copy.title = "نسخ الرقم";
            row.appendChild(copy);
            info.appendChild(row);
        });

        const edit = el("button", "icon-btn edit-btn");
        edit.type = "button";
        edit.dataset.edit = contact.id;
        edit.innerHTML = ICONS.edit;
        edit.setAttribute("aria-label", "تعديل " + contact.name);
        edit.title = "تعديل";

        item.append(avatar, info, edit);
        return item;
    }

    const listEl = document.getElementById("contactsList");
    const countEl = document.getElementById("contactsCount");
    const statusEl = document.getElementById("searchStatus");
    const searchInput = document.getElementById("searchInput");

    function emptyState(title, text, withActions) {
        const box = el("div", "empty-state");
        box.appendChild(el("h2", "", title));
        box.appendChild(el("p", "", text));
        if (withActions) {
            const actions = el("div", "empty-actions");
            const imp = el("button", "btn primary", "استيراد VCF");
            imp.type = "button";
            imp.addEventListener("click", () => vcfInput.click());
            const add = el("button", "btn", "إضافة اسم يدويًا");
            add.type = "button";
            add.addEventListener("click", () => openEditor(null));
            actions.append(imp, add);
            box.appendChild(actions);
            box.appendChild(el("p", "hint", "يمكنك أيضًا سحب ملف VCF وإفلاته هنا."));
        }
        return box;
    }

    function render() {
        const q = buildQuery(searchInput.value);
        const visible = contacts.filter(c => matches(c, q));

        countEl.textContent = String(contacts.length);
        statusEl.textContent = q.text
            ? `نتائج البحث: ${visible.length} من ${contacts.length}`
            : "";

        listEl.replaceChildren();

        if (contacts.length === 0) {
            listEl.appendChild(emptyState("دليلك جاهز", "استورد ملف جهات الاتصال VCF أو أضف اسمًا للبدء.", true));
            return;
        }
        if (visible.length === 0) {
            listEl.appendChild(emptyState("لا توجد نتائج", `لم أجد شيئًا يطابق «${q.raw}».`, false));
            return;
        }

        const fragment = document.createDocumentFragment();
        let currentLetter = null;
        visible.forEach(contact => {
            const letter = groupLetter(contact.name);
            if (letter !== currentLetter && !q.text) {
                currentLetter = letter;
                fragment.appendChild(el("div", "letter-head", letter));
            }
            fragment.appendChild(contactNode(contact));
        });
        listEl.appendChild(fragment);
    }

    let searchTimer = null;
    searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(render, 120);
    });

    /* ---------- الإشعارات مع زر تراجع ---------- */
    const toastEl = document.getElementById("toast");
    let toastTimer = null;

    function showToast(message, undo) {
        clearTimeout(toastTimer);
        toastEl.replaceChildren(el("span", "", message));
        if (undo) {
            const btn = el("button", "toast-undo", "تراجع");
            btn.type = "button";
            btn.addEventListener("click", () => {
                undo();
                toastEl.hidden = true;
            });
            toastEl.appendChild(btn);
        }
        toastEl.hidden = false;
        toastTimer = setTimeout(() => { toastEl.hidden = true; }, undo ? 7000 : 3500);
    }

    function restore(snapshot) {
        contacts = JSON.parse(snapshot);
        saveContacts();
        render();
        showToast("تمت الاستعادة");
    }

    /* ---------- النسخ والنقر داخل القائمة ---------- */
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const area = el("textarea");
            area.value = text;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            area.remove();
        }
        showToast("تم نسخ الرقم");
    }

    listEl.addEventListener("click", event => {
        const copyBtn = event.target.closest("[data-copy]");
        if (copyBtn) { copyText(copyBtn.dataset.copy); return; }
        const editBtn = event.target.closest("[data-edit]");
        if (editBtn) {
            const contact = contacts.find(c => c.id === editBtn.dataset.edit);
            if (contact) openEditor(contact);
        }
    });

    /* ---------- نافذة الإضافة والتعديل ---------- */
    const dialog = document.getElementById("contactDialog");
    const form = document.getElementById("contactForm");
    const nameField = document.getElementById("nameField");
    const phonesFields = document.getElementById("phonesFields");
    const deleteContactBtn = document.getElementById("deleteContact");
    let editingId = null;

    function addPhoneInput(value) {
        const row = el("div", "phone-input-row");
        const input = el("input");
        input.type = "tel";
        input.dir = "ltr";
        input.inputMode = "tel";
        input.placeholder = "05xxxxxxxx";
        input.value = value || "";
        const remove = el("button", "icon-btn", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", "حذف هذا الرقم");
        remove.addEventListener("click", () => {
            row.remove();
            if (!phonesFields.children.length) addPhoneInput("");
        });
        row.append(input, remove);
        phonesFields.appendChild(row);
        return input;
    }

    function openEditor(contact) {
        editingId = contact ? contact.id : null;
        document.getElementById("dialogTitle").textContent = contact ? "تعديل الاسم" : "إضافة اسم";
        nameField.value = contact ? contact.name : "";
        phonesFields.replaceChildren();
        (contact && contact.phones.length ? contact.phones : [""]).forEach(addPhoneInput);
        deleteContactBtn.hidden = !contact;

        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
        nameField.focus();
    }

    function closeEditor() {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
    }

    document.getElementById("addPhoneField").addEventListener("click", () => addPhoneInput("").focus());
    document.getElementById("cancelDialog").addEventListener("click", closeEditor);

    form.addEventListener("submit", event => {
        event.preventDefault();
        const name = nameField.value.replace(/\s+/g, " ").trim();
        if (!name) { nameField.focus(); return; }
        const phones = uniquePhones([...phonesFields.querySelectorAll("input")].map(i => i.value));

        if (editingId) {
            const contact = contacts.find(c => c.id === editingId);
            if (contact) { contact.name = name; contact.phones = phones; }
            showToast("تم حفظ التعديل");
        } else {
            contacts.push({ id: uid(), name, phones });
            showToast("تمت إضافة " + name);
        }
        sortContacts();
        saveContacts();
        closeEditor();
        render();
    });

    deleteContactBtn.addEventListener("click", () => {
        const contact = contacts.find(c => c.id === editingId);
        if (!contact || !confirm(`حذف «${contact.name}»؟`)) return;
        const before = JSON.stringify(contacts);
        contacts = contacts.filter(c => c.id !== editingId);
        saveContacts();
        closeEditor();
        render();
        showToast("تم حذف " + contact.name, () => restore(before));
    });

    document.getElementById("addButton").addEventListener("click", () => openEditor(null));

    /* ---------- الاستيراد (زر + سحب وإفلات) ---------- */
    const vcfInput = document.getElementById("vcfInput");
    document.getElementById("importButton").addEventListener("click", () => vcfInput.click());
    vcfInput.addEventListener("change", () => {
        if (vcfInput.files.length) importFiles(vcfInput.files);
        vcfInput.value = ""; // يسمح باستيراد الملف نفسه مرة أخرى
    });

    const dropOverlay = document.getElementById("dropOverlay");
    let dragDepth = 0;
    window.addEventListener("dragenter", e => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        dragDepth++;
        dropOverlay.hidden = false;
    });
    window.addEventListener("dragleave", () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) dropOverlay.hidden = true;
    });
    window.addEventListener("dragover", e => e.preventDefault());
    window.addEventListener("drop", e => {
        e.preventDefault();
        dragDepth = 0;
        dropOverlay.hidden = true;
        if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    });

    /* ---------- الحذف الكلي مع إمكانية التراجع ---------- */
    document.getElementById("deleteAllButton").addEventListener("click", () => {
        if (contacts.length === 0) { showToast("الدليل فارغ"); return; }
        if (!confirm(`هل أنت متأكد من حذف جميع الأسماء وعددها ${contacts.length}؟`)) return;
        const before = JSON.stringify(contacts);
        contacts = [];
        saveContacts();
        searchInput.value = "";
        render();
        showToast("تم حذف الجميع", () => restore(before));
    });

    /* ---------- التصدير ---------- */
    function stamp() {
        const now = new Date();
        const p = n => String(n).padStart(2, "0");
        return `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()}_${p(now.getHours())}-${p(now.getMinutes())}`;
    }

    function download(content, type, filename) {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = el("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function escapeVcf(value) {
        return value.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
    }

    document.getElementById("exportButton").addEventListener("click", () => {
        if (contacts.length === 0) { showToast("لا توجد أسماء لتصديرها"); return; }
        const vcf = contacts.map(c => {
            const name = escapeVcf(c.name);
            return [
                "BEGIN:VCARD",
                "VERSION:3.0",
                `N:;${name};;;`,
                `FN:${name}`,
                ...c.phones.map(p => `TEL;TYPE=CELL:${p}`),
                "END:VCARD"
            ].join("\r\n");
        }).join("\r\n") + "\r\n";
        download(vcf, "text/vcard;charset=utf-8", `contacts-${contacts.length}-${stamp()}.vcf`);
        showToast("تم تصدير نسخة احتياطية");
    });

    document.getElementById("csvExportButton").addEventListener("click", () => {
        if (contacts.length === 0) { showToast("لا توجد أسماء لتصديرها"); return; }
        const maxPhones = Math.max(1, ...contacts.map(c => c.phones.length));
        const cell = v => `"${String(v).replace(/"/g, '""')}"`;
        const headers = ["الاسم"];
        for (let i = 1; i <= maxPhones; i++) headers.push(`رقم الهاتف ${i}`);

        const rows = contacts.map(c => {
            const row = [cell(c.name)];
            for (let i = 0; i < maxPhones; i++) {
                const phone = c.phones[i] || "";
                // ="..." يمنع Excel من حذف الصفر الأول من الرقم
                row.push(cell(phone ? `="${phone.replace(/"/g, '""')}"` : ""));
            }
            return row.join(",");
        });

        const csv = ["sep=,", headers.map(cell).join(","), ...rows].join("\r\n");
        download("\uFEFF" + csv, "text/csv;charset=utf-8", `contacts-${contacts.length}-${stamp()}.csv`);
        showToast("تم التصدير إلى Excel");
    });

    /* ---------- اختصار لوحة المفاتيح: «/» للبحث ---------- */
    document.addEventListener("keydown", e => {
        if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
            e.preventDefault();
            searchInput.focus();
        }
    });

    /* ---------- العمل دون إنترنت ---------- */
    if ("serviceWorker" in navigator && location.protocol === "https:") {
        navigator.serviceWorker.register("sw.js").catch(() => { /* ليس ضروريًا */ });
    }

    // أول تشغيل: ترتيب البيانات القديمة وحفظها بالمعرّفات الجديدة
    sortContacts();
    if (!Array.isArray(window.DALIL_DEMO)) saveContacts();
    render();
})();
