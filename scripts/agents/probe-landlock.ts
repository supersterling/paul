import { Sandbox } from "@vercel/sandbox"

async function main() {
	console.log("creating sandbox...")
	const sandbox = await Sandbox.create({ runtime: "node24" })
	console.log(`sandbox created: ${sandbox.sandboxId}`)

	const commands: Array<{ label: string; cmd: string; args: string[] }> = [
		{ label: "kernel version", cmd: "uname", args: ["-r"] },
		{ label: "active LSMs", cmd: "cat", args: ["/sys/kernel/security/lsm"] },
		{ label: "landlock dir exists", cmd: "ls", args: ["-la", "/sys/kernel/security/landlock/"] },
		{ label: "landlock abi version", cmd: "cat", args: ["/sys/kernel/security/landlock/abi_version"] },
		{ label: "seccomp available", cmd: "grep", args: ["Seccomp", "/proc/self/status"] },
		{ label: "capabilities", cmd: "cat", args: ["/proc/self/status"] },
		{ label: "kernel config landlock", cmd: "sh", args: ["-c", "zcat /proc/config.gz 2>/dev/null | grep LANDLOCK || echo 'no /proc/config.gz'"] },
		{ label: "available node version", cmd: "node", args: ["--version"] },
	]

	for (const { label, cmd, args } of commands) {
		console.log(`\n--- ${label} ---`)
		const result = await sandbox.runCommand(cmd, args)
		const stdout = await result.stdout()
		const stderr = await result.stderr()
		console.log(`exit: ${result.exitCode}`)
		if (stdout.trim()) console.log(`stdout: ${stdout.trim()}`)
		if (stderr.trim()) console.log(`stderr: ${stderr.trim()}`)
	}

	console.log("\n--- landlock syscall test (node) ---")
	const landlockTest = `
const { syscall } = require('node:process');
// landlock_create_ruleset = 444 on x86_64
// Try calling with null args to see if the syscall exists
try {
  // We can't easily call raw syscalls from Node without native modules
  // But we can check if the landlock filesystem interface exists
  const fs = require('fs');
  try {
    const abi = fs.readFileSync('/sys/kernel/security/landlock/abi_version', 'utf8');
    console.log('Landlock ABI version: ' + abi.trim());
    console.log('LANDLOCK AVAILABLE: YES');
  } catch (e) {
    console.log('Landlock filesystem interface not found: ' + e.message);
    console.log('LANDLOCK AVAILABLE: NO');
  }
} catch (e) {
  console.log('Error: ' + e.message);
}
`
	const nodeResult = await sandbox.runCommand("node", ["-e", landlockTest])
	const nodeStdout = await nodeResult.stdout()
	const nodeStderr = await nodeResult.stderr()
	console.log(`exit: ${nodeResult.exitCode}`)
	if (nodeStdout.trim()) console.log(nodeStdout.trim())
	if (nodeStderr.trim()) console.log(`stderr: ${nodeStderr.trim()}`)

	console.log("\nStopping sandbox...")
	await sandbox.stop()
	console.log("Done.")
}

main()
