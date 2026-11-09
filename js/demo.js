(function () {
'use strict'; const { basicSetup, EditorView } = CM["codemirror"]; const { javascript, javascriptLanguage, scopeCompletionSource } = CM["@codemirror/lang-javascript"]; window.view = new EditorView({
doc: `




























`, extensions: [basicSetup, javascript(), javascriptLanguage.data.of({ autocomplete: scopeCompletionSource(globalThis) })], parent: document.querySelector("#editor")
});
})();