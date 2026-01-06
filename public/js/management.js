(function () {
  // 1) Remove success/error from URL after page load (so message doesn't persist)
  const url = new URL(window.location.href);
  const hadFlash = url.searchParams.has("success") || url.searchParams.has("error");
  if (hadFlash) {
    url.searchParams.delete("success");
    url.searchParams.delete("error");
    history.replaceState({}, "", url.toString());
  }

  // Helper: close any open Bootstrap modal before switching tabs
  function closeOpenModals() {
    // blur first to avoid aria-hidden focus warning
    document.activeElement?.blur();

    document.querySelectorAll(".modal.show").forEach((el) => {
      const instance = bootstrap.Modal.getInstance(el);
      if (instance) instance.hide();
    });
  }

  // 2) Restore active tab from URL on initial load
  const tabFromUrl = (new URL(window.location.href)).searchParams.get("tab") || "users";
  const btnToShow = document.querySelector(
    `#mgmtTabs [data-bs-toggle="pill"][data-bs-target="#pane-${CSS.escape(tabFromUrl)}"]`
  );

  if (btnToShow) {
    // show tab via Bootstrap API (more reliable than click())
    bootstrap.Tab.getOrCreateInstance(btnToShow).show();
  }

  // 3) When a tab is shown, update the URL ?tab=...
  const tabButtons = document.querySelectorAll('#mgmtTabs [data-bs-toggle="pill"]');

  tabButtons.forEach((btn) => {
    btn.addEventListener("show.bs.tab", () => {
      // before tab actually switches, close any open modals
      closeOpenModals();
    });

    btn.addEventListener("shown.bs.tab", (event) => {
      const targetSel = event.target.getAttribute("data-bs-target"); // e.g. #pane-roles
      const tabName = targetSel?.replace("#pane-", "") || "users";

      const u = new URL(window.location.href);
      u.searchParams.set("tab", tabName);

      // only keep perm pagination params when you're on perms tab
      if (tabName !== "perms") {
        u.searchParams.delete("permPage");
        u.searchParams.delete("permPageSize");
      } else {
        if (!u.searchParams.get("permPage")) u.searchParams.set("permPage", "1");
        if (!u.searchParams.get("permPageSize")) u.searchParams.set("permPageSize", "10");
      }

      // Always clear flash params on tab switch too
      u.searchParams.delete("success");
      u.searchParams.delete("error");

      history.replaceState({}, "", u.toString());
    });
  });
})();
