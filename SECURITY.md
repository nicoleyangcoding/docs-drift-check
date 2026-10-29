# Security policy

This action reads pull request metadata, the changed file list and one config file through the GitHub API, and can post or edit one comment. It never checks out or runs code from the pull request. It reads its rules from the base branch, so a pull request can't change how it is checked.

If you find a security problem, please report it privately through [GitHub's private vulnerability reporting](https://github.com/nicoleyangcoding/docs-drift-check/security/advisories/new) rather than opening a public issue. You can expect a reply within 7 days.
