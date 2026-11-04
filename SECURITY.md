# Security
Report vulnerabilities privately via GitHub *Security → Report a vulnerability* (or email the maintainer). Please do not open public issues for security problems.

Design notes: page-supplied manifest URLs are never trusted (the background re-analyses them); popup builds DOM without `innerHTML`; no `eval`; remote content is limited to http(s) media of the current page; header-rewrite rules apply only to the extension's own requests (`tabIds: [-1]`) and are removed when a job ends.
