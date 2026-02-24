import { Sandbox } from "@vercel/sandbox"

async function run(sandbox: Sandbox, label: string, cmd: string, args: string[]) {
	console.log(`\n--- ${label} ---`)
	console.log(`  runCommand(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`)
	const result = await sandbox.runCommand(cmd, args)
	const stdout = await result.stdout()
	const stderr = await result.stderr()
	console.log(`  exit: ${result.exitCode}`)
	if (stdout.trim()) console.log(`  stdout: ${stdout.trim()}`)
	if (stderr.trim()) console.log(`  stderr: ${stderr.trim()}`)
}

async function main() {
	console.log("creating sandbox...")
	const sandbox = await Sandbox.create({ runtime: "node24", networkPolicy: "deny-all" })
	console.log(`sandbox: ${sandbox.sandboxId}`)

	console.log("\n========== SHELL INJECTION TESTS ==========")
	console.log("Testing if runCommand passes args through a shell or uses direct exec.")
	console.log("If shell: && ; | $() will be INTERPRETED as operators.")
	console.log("If exec: they will be LITERAL string arguments.")

	await run(sandbox, "echo with && in args (shell injection attempt)",
		"echo", ["hello", "&&", "whoami"])

	await run(sandbox, "echo with ; in args",
		"echo", ["hello", ";", "whoami"])

	await run(sandbox, "echo with | in args",
		"echo", ["hello", "|", "whoami"])

	await run(sandbox, "echo with $() in args",
		"echo", ["hello", "$(whoami)"])

	await run(sandbox, "echo with backticks in args",
		"echo", ["hello", "`whoami`"])

	console.log("\n========== BASELINE: EXPLICIT SHELL ==========")

	await run(sandbox, "sh -c with && (explicit shell invocation)",
		"sh", ["-c", "echo hello && whoami"])

	await run(sandbox, "sh -c with pipe (explicit shell invocation)",
		"sh", ["-c", "echo hello | cat"])

	console.log("\n========== DENYLIST BYPASS VECTORS ==========")

	await run(sandbox, "sh -c with sudo (bypass denylist via shell)",
		"sh", ["-c", "sudo whoami"])

	await run(sandbox, "node -e running whoami (bypass via runtime)",
		"node", ["-e", "const {execSync} = require('node:child_process'); console.log(execSync('whoami').toString())"])

	console.log("\nStopping sandbox...")
	await sandbox.stop()
	console.log("Done.")
}

main()
