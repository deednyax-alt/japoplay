/**
 * JapoPlay Web Application Manifest & View Engine Configurations
 */
window.JAPOPLAY_MANIFEST = {
  name: "JapoPlay Streaming",
  shortName: "JapoPlay",
  version: "1.0.0",
  themeColor: "#09090b",
  backgroundColor: "#09090b",
  displayMode: "standalone",
  orientation: "any"
};

// Ensure consistent layout dimensions on all browsers & localhost viewports
(function syncViewDimensions() {
  function enforceViewportFixes() {
    const heroBanner = document.querySelector('.hero-banner');
    if (heroBanner) {
      heroBanner.style.setProperty('min-height', '440px', 'important');
    }
    const heroActions = document.querySelector('.hero-actions');
    if (heroActions) {
      heroActions.style.setProperty('display', 'flex', 'important');
      heroActions.style.setProperty('visibility', 'visible', 'important');
      heroActions.style.setProperty('opacity', '1', 'important');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enforceViewportFixes);
  } else {
    enforceViewportFixes();
  }
  window.addEventListener('resize', enforceViewportFixes);
})();
