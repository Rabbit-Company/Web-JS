import dts from "bun-plugin-dts";
import fs from "fs/promises";
import { Logger } from "@rabbit-company/logger";

const logger = new Logger();

// Clean up old build artifacts
await fs.rm("./dist", { recursive: true, force: true });
await fs.rm("./packages/core/dist", { recursive: true, force: true });
await fs.rm("./packages/middleware/dist", { recursive: true, force: true });

async function buildPackage(packageName: string, entryPoint: string, outputName?: string) {
	const packagePath = `./packages/${packageName}`;
	const srcPath = `${packagePath}/src`;
	const distPath = `${packagePath}/dist`;

	logger.info(`Building ${packageName} package...`);

	try {
		// Build ESM version
		const esmBuild = await Bun.build({
			entrypoints: [`${srcPath}/${entryPoint}`],
			outdir: distPath,
			target: "node",
			format: "esm",
			plugins: [dts({ output: { noBanner: true } })],
			splitting: false,
			minify: false,
		});

		if (!esmBuild.success) {
			logger.error(`ESM build failed for ${packageName}:`, esmBuild.logs);
			return false;
		}

		// Build CJS version
		const cjsBuild = await Bun.build({
			entrypoints: [`${srcPath}/${entryPoint}`],
			outdir: distPath,
			target: "node",
			format: "cjs",
			splitting: false,
			minify: false,
		});

		if (!cjsBuild.success) {
			logger.error(`CJS build failed for ${packageName}:`, cjsBuild.logs);
			return false;
		}

		// Rename CJS output to .cjs extension
		const indexJs = `${distPath}/index.js`;
		const indexCjs = `${distPath}/index.cjs`;

		// Check if CJS file exists and rename it
		try {
			await fs.access(indexJs);
			await fs.rename(indexJs, indexCjs);
		} catch (error) {
			// If index.js doesn't exist, the CJS build might have different naming
			logger.warn(`Could not find ${indexJs} to rename to .cjs`);
		}

		// Rebuild ESM after CJS rename to avoid conflicts
		const esmRebuild = await Bun.build({
			entrypoints: [`${srcPath}/${entryPoint}`],
			outdir: distPath,
			target: "node",
			format: "esm",
			plugins: [dts({ output: { noBanner: true } })],
			splitting: false,
			minify: false,
		});

		if (!esmRebuild.success) {
			logger.error(`ESM rebuild failed for ${packageName}:`, esmRebuild.logs);
			return false;
		}

		logger.info(`${packageName} package built successfully`);
		return true;
	} catch (error: any) {
		logger.error(`Build failed for ${packageName}:`, error);
		return false;
	}
}

async function buildAllMiddleware() {
	const middlewarePath = "./packages/middleware/src";
	const distPath = "./packages/middleware/dist";

	logger.info("Building individual middleware files...");

	try {
		// Build auth middleware individually
		const files = await fs.readdir(`${middlewarePath}/`);
		for (const file of files) {
			if (file.endsWith(".ts") && file !== "index.ts") {
				const name = file.replace(".ts", "");
				await Bun.build({
					entrypoints: [`${middlewarePath}/${file}`],
					outdir: `${distPath}`,
					target: "node",
					format: "esm",
					plugins: [dts({ output: { noBanner: true } })],
				});
			}
		}

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
	const coreSuccess = await buildPackage("core", "index.ts", "web");

	// Build individual middleware files for tree-shaking
	const individualSuccess = await buildAllMiddleware();

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
