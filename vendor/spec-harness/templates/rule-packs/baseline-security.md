# Baseline pack: security

<!-- rule-layer: baseline -->
<!-- pack: baseline-security -->

- **SEC-01** Never commit a secret, key or token to the repository; load it from a secrets store or the build environment. (source: OWASP Secrets Management Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- **SEC-02** Validate every input that crosses a trust boundary on the side that trusts it, with an allow list where possible. (source: OWASP Input Validation Cheat Sheet, listed in the ASVS index, https://cheatsheetseries.owasp.org/IndexASVS.html)
- **SEC-03** Never show users a stack trace, an internal path or a raw backend error. (source: OWASP Error Handling Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
- **SEC-04** Keep personal data and credentials out of logs, analytics and error reports unless a recorded decision allows a named field. (source: OWASP Proactive Controls index, https://cheatsheetseries.owasp.org/IndexProactiveControls.html)
- **SEC-05** Add or upgrade a dependency only after checking that it is maintained and has no known vulnerability that affects the project. (source: OWASP ASVS index, https://cheatsheetseries.owasp.org/IndexASVS.html)
