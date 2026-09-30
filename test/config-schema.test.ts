import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

const Ajv = createRequire(import.meta.url)("ajv") as new (options?: object) => {
	validate(schema: object, data: unknown): boolean;
	compile(schema: object): (data: unknown) => boolean;
	errorsText(): string;
};

const root = join(import.meta.dirname, "..");
const ajv = new Ajv({ allErrors: true, strict: false });

function validate(schemaFile: string, dataFile: string) {
	const schema = JSON.parse(readFileSync(join(root, "schemas", schemaFile), "utf8"));
	const data = JSON.parse(readFileSync(join(root, dataFile), "utf8"));
	const ok = ajv.validate(schema, data);
	assert.equal(ok, true, ajv.errorsText());
}

test("the answers fixture matches answers.schema.json", () => {
	validate("answers.schema.json", "test/fixtures/answers.json");
});

test("a model-agents fallback file matches model-agents.schema.json", () => {
	const schema = JSON.parse(readFileSync(join(root, "schemas", "model-agents.schema.json"), "utf8"));
	const validateSchema = ajv.compile(schema);
	const ok = validateSchema({
		fallbacks: { anthropic: [{ provider: "openrouter", id: "openai/gpt-5.4" }] },
		agentFallbacks: { worker: [{ provider: "anthropic", id: "claude-sonnet-4.6" }] },
	});
	assert.equal(ok, true, ajv.errorsText());
});
