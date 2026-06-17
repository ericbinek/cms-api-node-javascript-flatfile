# Contributing to cms-api-node-javascript-flatfile

Thanks for taking a look. This is a build-in-public project at version 0.3.0, so it is still moving and contributions of every kind are welcome: bug reports, questions, ideas, and code.

## Ground rules

- Stay on Node's built in modules. The point of this project is the standard library, so please do not add npm packages.
- The conformance test suite is the contract. If you change behavior, change the tests in the same pull request and explain why. Keep them green.
- This is not production software, and the README says so. Please keep that framing.

## Getting started

```sh
git clone https://github.com/ericbinek/cms-api-node-javascript-flatfile.git
cd cms-api-node-javascript-flatfile
cp .env.example .env
```

Run it:

```sh
node src/server.mjs
```

Run the tests:

```sh
node --test "test/*.test.mjs"
```

There is no `npm install` step and no `node_modules`: Node's built in modules are all you need.

## Sending a change

1. For anything beyond a small fix, open an issue or discussion first so we do not duplicate work.
2. Keep each pull request focused on one thing.
3. Run the test suite locally and make sure it is green before you open the pull request.
4. Describe what changed and why.

## Style

ES modules and `node:` imports, no transpilation and no framework. Match the surrounding code.
