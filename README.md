# emulator-utility

## AWS Emulator Console

```sh
docker compose up --build        # the Emulator plus the console on http://127.0.0.1:9300
```

**Memory.** The image build compiles the web app, which bundles one lazy chunk per AWS SDK client (436 of them). Measured on macOS arm64 with Node 26: peak about **6.9 GB** resident memory (it fails with a 5 GB heap), about 40 s. Give the Docker VM **at least 8 GB**. Check what yours has:

```sh
docker info --format '{{.MemTotal}}'     # bytes: 8589934592 is 8 GB
```

If it has less, build the web app on the host and let the image copy it (one command):

```sh
pnpm --dir console build && CONSOLE_WEB_SOURCE=prebuilt docker compose up --build
```

The prebuilt dist is stamped with the Catalog fingerprint, and the image build fails if it was built for a different Catalog. See `console/README.md`.

**Who can reach it.** The console binds `127.0.0.1`, but on that port any process or user on this host, and any container on the compose network, can read the Emulator Credentials and call the Emulator through it. Multi-user hosts are out of scope (ADR-0003).
