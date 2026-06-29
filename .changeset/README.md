# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

## Adding a changeset

Run `npx changeset` to create a changeset describing your change. Each PR that modifies user-facing behavior should include a changeset describing the semver impact.

Changesets are consumed during release to generate the changelog and bump versions.
