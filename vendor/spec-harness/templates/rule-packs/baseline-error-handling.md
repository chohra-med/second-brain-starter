# Baseline pack: error handling

<!-- rule-layer: baseline -->
<!-- pack: baseline-error-handling -->

- **ERR-01** Handle every failed request and rejected promise, and give the user a way to recover or retry. (source: OWASP Proactive Controls index, Handle All Errors and Exceptions, https://cheatsheetseries.owasp.org/IndexProactiveControls.html)
- **ERR-02** Register one global error handler that catches what local handlers miss. (source: OWASP Error Handling Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
- **ERR-03** Never swallow an error silently; log or report it with enough context to reproduce it. (source: OWASP Error Handling Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
