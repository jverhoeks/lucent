BIN_NAME = Lucent

.PHONY: build dev release test clean

build: release

dev:
	npm run tauri dev

release:
	npm run tauri build

test:
	npm test

clean:
	rm -rf dist/
	cargo clean --manifest-path src-tauri/Cargo.toml
