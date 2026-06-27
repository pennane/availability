.PHONY: generate generate-go generate-ts

generate: generate-go generate-ts

generate-go:
	cd api && oapi-codegen -config oapi-codegen.yaml openapi.yaml

generate-ts:
	cd api && pnpm run generate
