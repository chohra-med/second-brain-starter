# Standard pack: OWASP Mobile Application Security Verification Standard (MASVS)

<!-- rule-layer: standard -->
<!-- pack: standard-owasp-masvs -->
<!-- standard: OWASP MASVS -->

Adopt this pack only when `.memory/10-product.md` records a commitment to it, and add
`<!-- commitment: STD-<n> -->` here. Checked on 2026-10-21.

- **MASVS-01** Store tokens and other sensitive data only in the platform's secure storage, never in plain app storage. (source: OWASP MASVS, https://mas.owasp.org/MASVS/, MASVS-STORAGE)
- **MASVS-02** Send all network traffic over TLS and never turn off certificate validation. (source: OWASP MASVS, https://mas.owasp.org/MASVS/, MASVS-NETWORK)
- **MASVS-03** Collect and keep only the personal data a feature needs, and tell the user what is collected. (source: OWASP MASVS, https://mas.owasp.org/MASVS/, MASVS-PRIVACY)
- **MASVS-04** Keep authentication and authorization decisions on the backend, not only in the app. (source: OWASP MASVS, https://mas.owasp.org/MASVS/, MASVS-AUTH)
