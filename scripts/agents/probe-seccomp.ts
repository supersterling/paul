import { Sandbox } from "@vercel/sandbox"

async function run(sandbox: Sandbox, label: string, cmd: string, args: string[]) {
	console.log(`\n--- ${label} ---`)
	console.log(`  $ ${cmd} ${args.join(" ")}`)
	const result = await sandbox.runCommand(cmd, args)
	const stdout = await result.stdout()
	const stderr = await result.stderr()
	const status = result.exitCode === 0 ? "ALLOWED" : `BLOCKED/FAILED (exit ${result.exitCode})`
	console.log(`  ${status}`)
	if (stdout.trim()) {
		const lines = stdout.trim().split("\n")
		const preview = lines.length > 5 ? lines.slice(0, 5).join("\n") + `\n  ... (${lines.length} lines)` : stdout.trim()
		console.log(`  stdout: ${preview}`)
	}
	if (stderr.trim()) {
		const lines = stderr.trim().split("\n")
		const preview = lines.length > 3 ? lines.slice(0, 3).join("\n") + `\n  ... (${lines.length} lines)` : stderr.trim()
		console.log(`  stderr: ${preview}`)
	}
}

async function main() {
	console.log("creating sandbox with deny-all networking...")
	const sandbox = await Sandbox.create({
		runtime: "node24",
		networkPolicy: "deny-all"
	})
	console.log(`sandbox: ${sandbox.sandboxId}`)

	console.log("\n========== NETWORK ==========")
	await run(sandbox, "curl (outbound HTTP)", "sh", ["-c", "curl -s --max-time 5 https://httpbin.org/get 2>&1 || echo 'CURL FAILED'"])
	await run(sandbox, "wget (outbound HTTP)", "sh", ["-c", "wget -q --timeout=5 -O- https://httpbin.org/get 2>&1 || echo 'WGET FAILED'"])
	await run(sandbox, "ping (ICMP)", "sh", ["-c", "ping -c 1 -W 3 8.8.8.8 2>&1 || echo 'PING FAILED'"])
	await run(sandbox, "DNS resolution", "sh", ["-c", "nslookup google.com 2>&1 || echo 'DNS FAILED'"])

	console.log("\n========== FILESYSTEM (destructive) ==========")
	await run(sandbox, "rm -rf /tmp (non-critical)", "sh", ["-c", "mkdir -p /tmp/test123 && rm -rf /tmp/test123 && echo 'RM WORKED'"])
	await run(sandbox, "rm -rf /vercel (critical)", "sh", ["-c", "rm -rf /vercel/sandbox 2>&1; echo 'exit: '$?"])
	await run(sandbox, "write to /etc", "sh", ["-c", "echo test > /etc/test_probe 2>&1 || echo 'WRITE FAILED'"])
	await run(sandbox, "write to /root", "sh", ["-c", "echo test > /root/test_probe 2>&1 || echo 'WRITE FAILED'"])
	await run(sandbox, "chmod +x arbitrary", "sh", ["-c", "touch /tmp/test.sh && chmod +x /tmp/test.sh && echo 'CHMOD WORKED'"])

	console.log("\n========== PROCESS/SYSTEM ==========")
	await run(sandbox, "mount (filesystem mount)", "sh", ["-c", "mount -t tmpfs none /mnt 2>&1 || echo 'MOUNT FAILED'"])
	await run(sandbox, "sudo (privilege escalation)", "sh", ["-c", "sudo whoami 2>&1"])
	await run(sandbox, "sudo rm -rf /", "sh", ["-c", "sudo rm -rf / --no-preserve-root 2>&1; echo 'survived'"])
	await run(sandbox, "kill init (PID 1)", "sh", ["-c", "kill -9 1 2>&1 || echo 'KILL FAILED'"])
	await run(sandbox, "fork bomb attempt", "sh", ["-c", ":(){ :|:& };: 2>&1 &; sleep 2; echo 'fork bomb result: '$?"])
	await run(sandbox, "ptrace (debug other proc)", "sh", ["-c", "strace -p 1 2>&1 || echo 'PTRACE FAILED'"])
	await run(sandbox, "dmesg (kernel logs)", "sh", ["-c", "dmesg 2>&1 | head -5 || echo 'DMESG FAILED'"])

	console.log("\n========== COMMON DEV TOOLS ==========")
	await run(sandbox, "find", "find", ["/vercel/sandbox", "-maxdepth", "1", "-type", "f"])
	await run(sandbox, "grep", "grep", ["-r", "sandbox", "/vercel/sandbox/", "--include=*.txt", "-l"])
	await run(sandbox, "ls -la", "ls", ["-la", "/vercel/sandbox/"])
	await run(sandbox, "cat", "cat", ["/etc/os-release"])
	await run(sandbox, "head", "head", ["-5", "/etc/os-release"])
	await run(sandbox, "tail", "tail", ["-5", "/etc/os-release"])
	await run(sandbox, "wc", "sh", ["-c", "echo 'hello world' | wc -w"])
	await run(sandbox, "diff", "sh", ["-c", "echo a > /tmp/a.txt && echo b > /tmp/b.txt && diff /tmp/a.txt /tmp/b.txt; echo 'diff ran'"])
	await run(sandbox, "sort", "sh", ["-c", "echo -e 'c\na\nb' | sort"])
	await run(sandbox, "git", "sh", ["-c", "git --version 2>&1"])
	await run(sandbox, "sed", "sh", ["-c", "echo 'hello world' | sed 's/world/sandbox/'"])
	await run(sandbox, "awk", "sh", ["-c", "echo 'hello world' | awk '{print $2}'"])
	await run(sandbox, "xargs", "sh", ["-c", "echo '/tmp' | xargs ls 2>&1 | head -3"])
	await run(sandbox, "env", "env", [])
	await run(sandbox, "which node", "which", ["node"])

	console.log("\n========== SECCOMP DETAILS ==========")
	await run(sandbox, "seccomp status", "grep", ["Seccomp", "/proc/self/status"])
	await run(sandbox, "read seccomp filter (bpf)", "sh", ["-c", "cat /proc/1/status | grep -E 'Seccomp|NoNewPrivs'"])

	console.log("\nStopping sandbox...")
	await sandbox.stop()
	console.log("Done.")
}

main()
