const INSTALL_MARKER = '__resumeDesignerCompanionContentInstalled';

if (!globalThis[INSTALL_MARKER]) {
  Object.defineProperty(globalThis, INSTALL_MARKER, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}
