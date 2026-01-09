import { getJson, postJson, putJson, toast } from "./shared.js";

function _initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function _closeMenu(menuEl, btnEl) {
  if (!menuEl || !btnEl) return;
  menuEl.hidden = true;
  btnEl.setAttribute("aria-expanded", "false");
}

function _openMenu(menuEl, btnEl) {
  if (!menuEl || !btnEl) return;
  menuEl.hidden = false;
  btnEl.setAttribute("aria-expanded", "true");
}

function _toggleMenu(menuEl, btnEl) {
  if (!menuEl || !btnEl) return;
  if (menuEl.hidden) _openMenu(menuEl, btnEl);
  else _closeMenu(menuEl, btnEl);
}

function _setActiveUserId(userId) {
  try {
    localStorage.setItem("activeUserId", String(userId || ""));
  } catch (_) {
    // ignore
  }
}

function _getActiveUserId() {
  try {
    return (localStorage.getItem("activeUserId") || "").trim();
  } catch (_) {
    return "";
  }
}

function _renderProfileButton({ user }) {
  const nameEl = document.getElementById("profileName");
  const avatarEl = document.getElementById("profileAvatar");

  if (nameEl) nameEl.textContent = user?.display_name || "Profile";
  if (avatarEl) avatarEl.textContent = _initials(user?.display_name || "");
}

function _showModal({ title, initialName = "", initialEmail = "", primaryText = "Save" }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modalRoot");
    if (!root) return resolve(null);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal__header">
          <div class="modal__title">${title}</div>
          <button class="icon-btn" id="modalClose" aria-label="Close">✕</button>
        </div>
        <div class="modal__body">
          <div class="form" style="grid-template-columns: 1fr;">
            <label class="label">Display name</label>
            <input class="control" id="modalName" placeholder="e.g., Peeyush" value="${initialName.replaceAll('"', "&quot;")}" />
            <label class="label">Email (optional)</label>
            <input class="control" id="modalEmail" placeholder="name@example.com" value="${(initialEmail || "").replaceAll('"', "&quot;")}" />
          </div>
          <div class="muted" style="margin-top: 8px; font-size: 12px;">
            Profiles are stored locally (no passwords in this build).
          </div>
        </div>
        <div class="modal__footer">
          <button class="btn" id="modalCancel">Cancel</button>
          <button class="btn btn--primary" id="modalSave">${primaryText}</button>
        </div>
      </div>
    `;

    root.appendChild(backdrop);

    const close = () => {
      backdrop.remove();
    };

    const onCancel = () => {
      close();
      resolve(null);
    };

    const onSave = () => {
      const name = backdrop.querySelector("#modalName")?.value?.trim() || "";
      const email = backdrop.querySelector("#modalEmail")?.value?.trim() || "";
      if (!name) {
        toast("Please enter a display name", "warn");
        return;
      }
      close();
      resolve({ display_name: name, email: email || null });
    };

    backdrop.querySelector("#modalClose")?.addEventListener("click", onCancel);
    backdrop.querySelector("#modalCancel")?.addEventListener("click", onCancel);
    backdrop.querySelector("#modalSave")?.addEventListener("click", onSave);

    // Click outside modal closes
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) onCancel();
    });

    // ESC closes
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") onCancel();
      },
      { once: true }
    );

    // Autofocus
    window.setTimeout(() => {
      backdrop.querySelector("#modalName")?.focus();
    }, 0);
  });
}

function _renderMenu({ menuEl, users, activeId, onSwitch, onCreate, onEdit }) {
  const rows = users
    .map((u) => {
      const active = u.user_id === activeId;
      return `
        <button class="menu__item ${active ? "menu__item--active" : ""}" data-user-id="${u.user_id}">
          <span class="avatar avatar--sm">${_initials(u.display_name)}</span>
          <span class="menu__label">${u.display_name}</span>
          ${active ? '<span class="menu__check">✓</span>' : ""}
        </button>
      `;
    })
    .join("");

  menuEl.innerHTML = `
    <div class="menu__section">
      <div class="menu__title">Profiles</div>
      <div class="menu__list">${rows || '<div class="muted" style="padding:10px;">No profiles yet</div>'}</div>
    </div>
    <div class="menu__divider"></div>
    <div class="menu__section">
      <button class="menu__item" id="menuCreate">
        <span class="menu__label">Create new profile…</span>
      </button>
      <button class="menu__item" id="menuEdit">
        <span class="menu__label">Edit current profile…</span>
      </button>
    </div>
  `;

  menuEl.querySelectorAll("button[data-user-id]").forEach((btn) => {
    btn.addEventListener("click", () => onSwitch(btn.getAttribute("data-user-id")));
  });
  menuEl.querySelector("#menuCreate")?.addEventListener("click", onCreate);
  menuEl.querySelector("#menuEdit")?.addEventListener("click", onEdit);
}

async function _ensureDefaultProfile(users) {
  if (users.length > 0) return users;

  // Create a sensible default profile locally.
  const created = await postJson("/api/v1/users", { display_name: "Local", email: null });
  return [created];
}

export async function initProfiles() {
  const btn = document.getElementById("profileButton");
  const menu = document.getElementById("profileMenu");

  if (!btn || !menu) return;

  let users = [];
  try {
    users = await getJson("/api/v1/users");
    users = await _ensureDefaultProfile(users);
  } catch (e) {
    // If backend is down, still show a placeholder.
    _renderProfileButton({ user: { display_name: "Offline" } });
    return;
  }

  let activeId = _getActiveUserId();
  if (!activeId || !users.some((u) => u.user_id === activeId)) {
    activeId = users[0].user_id;
    _setActiveUserId(activeId);
  }

  const getActiveUser = () => users.find((u) => u.user_id === activeId) || users[0];
  _renderProfileButton({ user: getActiveUser() });

  const refreshMenu = () => {
    _renderMenu({
      menuEl: menu,
      users,
      activeId,
      onSwitch: async (uid) => {
        if (!uid || uid === activeId) {
          _closeMenu(menu, btn);
          return;
        }
        activeId = uid;
        _setActiveUserId(activeId);
        _renderProfileButton({ user: getActiveUser() });
        _closeMenu(menu, btn);
        toast(`Switched to ${getActiveUser().display_name}`, "info");
        window.dispatchEvent(new CustomEvent("profile:changed"));
      },
      onCreate: async () => {
        _closeMenu(menu, btn);
        const data = await _showModal({ title: "Create profile", primaryText: "Create" });
        if (!data) return;
        try {
          const created = await postJson("/api/v1/users", data);
          users = [created, ...users];
          activeId = created.user_id;
          _setActiveUserId(activeId);
          _renderProfileButton({ user: getActiveUser() });
          toast("Profile created", "success");
          window.dispatchEvent(new CustomEvent("profile:changed"));
        } catch (e) {
          toast(String(e.message || e), "error", 4200);
        }
      },
      onEdit: async () => {
        _closeMenu(menu, btn);
        const current = getActiveUser();
        const data = await _showModal({
          title: "Edit profile",
          primaryText: "Save",
          initialName: current.display_name,
          initialEmail: current.email || "",
        });
        if (!data) return;
        try {
          const updated = await putJson(`/api/v1/users/${current.user_id}`, data);
          users = users.map((u) => (u.user_id === updated.user_id ? updated : u));
          _renderProfileButton({ user: getActiveUser() });
          toast("Profile updated", "success");
          window.dispatchEvent(new CustomEvent("profile:changed"));
        } catch (e) {
          toast(String(e.message || e), "error", 4200);
        }
      },
    });
  };

  refreshMenu();

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    refreshMenu();
    _toggleMenu(menu, btn);
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    const inside = e.target.closest("#profileButton") || e.target.closest("#profileMenu");
    if (!inside) _closeMenu(menu, btn);
  });
}
