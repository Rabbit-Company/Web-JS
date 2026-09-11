import fs from "fs/promises";
import { dirname, join } from "path";
import { Logger } from "@rabbit-company/logger";

const logger = new Logger();

// Located through package.json because TypeScript 7 doesn't export its bin entry
const typescriptPackage = Bun.resolveSync("typescript/package.json", import.meta.dir);
const tsc = join(dirname(typescriptPackage), (await Bun.file(typescriptPackage).json()).bin.tsc);

// Clean up old build artifacts
await fs.rm("./dist", { recursive: true, force: true });
await fs.rm("./packages/core/dist", { recursive: true, force: true });
await fs.rm("./packages/middleware/dist", { recursive: true, force: true });

/**
 * Emits type declarations with tsc using the package's tsconfig.build.json.
 */
async function buildTypes(packageName: string): Promise<boolean> {
	logger.info(`Generating ${packageName} type declarations...`);

	const proc = Bun.spawn([process.execPath, tsc, "-p", `./packages/${packageName}/tsconfig.build.json`], {
		stdout: "inherit",
		stderr: "inherit",
	});

	if ((await proc.exited) !== 0) {
		logger.error(`Type declarations failed for ${packageName}`);
		return false;
	}

	return true;
}

async function buildCore() {
	const srcPath = "./packages/core/src";
	const distPath = "./packages/core/dist";

	logger.info("Building core package...");

	try {
		// Build ESM version
		const esmBuild = await Bun.build({
			entrypoints: [`${srcPath}/index.ts`],
			outdir: distPath,
			target: "node",
			format: "esm",
			splitting: false,
			minify: false,
		});

		if (!esmBuild.success) {
			logger.error("ESM build failed for core:", esmBuild.logs);
			return false;
		}

		// Build CJS version
		const cjsBuild = await Bun.build({
			entrypoints: [`${srcPath}/index.ts`],
			outdir: distPath,
			target: "node",
			format: "cjs",
			naming: "[name].cjs",
			splitting: false,
			minify: false,
		});

		if (!cjsBuild.success) {
			logger.error("CJS build failed for core:", cjsBuild.logs);
			return false;
		}

		if (!(await buildTypes("core"))) return false;

		logger.info("core package built successfully");
		return true;
	} catch (error: any) {
		logger.error("Build failed for core:", error);
		return false;
	}
}

async function buildAllMiddleware() {
	const middlewarePath = "./packages/middleware/src";
	const distPath = "./packages/middleware/dist";

	logger.info("Building individual middleware files...");

	try {
		// Build each middleware individually for tree-shaking
		const files = await fs.readdir(`${middlewarePath}/`);
		for (const file of files) {
			if (file.endsWith(".ts") && file !== "index.ts") {
				const build = await Bun.build({
					entrypoints: [`${middlewarePath}/${file}`],
					outdir: `${distPath}`,
					target: "node",
					format: "esm",
				});

				if (!build.success) {
					logger.error(`Build failed for middleware ${file}:`, build.logs);
					return false;
				}
			}
		}

		// Middleware declarations import core's types, so core must be built first
		if (!(await buildTypes("middleware"))) return false;

		logger.info("Individual middleware files built successfully");
		return true;
	} catch (error: any) {
		logger.error("Failed to build individual middleware files:", error);
		return false;
	}
}

// Build packages
async function main() {
	logger.info("Starting monorepo build...");

	// Build core package
	const coreSuccess = await buildCore();

	// Build individual middleware files for tree-shaking
	const individualSuccess = coreSuccess && (await buildAllMiddleware());

	if (coreSuccess && individualSuccess) {
		logger.info("All packages built successfully!");

		// Log build summary
		logger.info("Build Summary:");
		logger.info("  ✓ Core package: packages/core/dist/");
		logger.info("  ✓ Individual middleware files for tree-shaking");
	} else {
		logger.error("Some packages failed to build");
		process.exit(1);
	}
}

main().catch((error) => {
	logger.error("Build process failed:", error);
	process.exit(1);
});
