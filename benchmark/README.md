# Benchmarks

The benchmark harness measures selected internal costs that are intentional but
workload-sensitive: large query normalization, retry-context rebuilding,
response-hook isolation, and retryable-body snapshots. Retryable-body scenarios
include a string control alongside copied `ArrayBuffer` and reconstructed
`FormData` inputs.

Run the full local benchmark after building the current source:

```bash
npm run benchmark
```

Use `--json` for machine-readable output, `--output <path>` to record a report,
and `--baseline <path>` to display descriptive ratios against an earlier
report. Baseline comparison never changes the process exit code.

`npm run benchmark:smoke` runs every scenario with minimal sampling. CI and the
release workflow use this mode only to prevent the harness from becoming stale;
they do not enforce timing thresholds.

Reports include the Node.js and host environment, package version, Git commit,
dirty-worktree state, sample configuration, and raw samples. Compare performance
changes on the same machine and Node.js version whenever possible. Checked-in
results are observations, not service-level objectives or proof of performance
on other hardware.

The initial `v1.0.9-planning` baseline intentionally records the current dirty
release-planning worktree. Refresh it from a clean release-candidate commit
before treating it as the canonical v1.0.9 reference.

The harness must not motivate changes that weaken caller isolation, retry-body
replayability, independent sequential response hooks, or other documented
behavioral guarantees.
