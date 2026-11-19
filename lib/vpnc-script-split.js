// ============================================================================
// Tongji VPN split-tunnel wrapper script -- Microsoft JScript / ECMAScript 3.0
//
// Usage: openconnect --script="<path to this file>"
//
// Purpose: make the Tongji AG tunnel carry ONLY Tongji intranet traffic instead
// of hijacking the machine's default route and DNS. Three things:
//   1) add only the 10.67.0.0/16 route into the tunnel, no 0.0.0.0/0 default route
//   2) do NOT take over system DNS (keep local/hotspot DNS)
//   3) pin agi.tongji.edu.cn to the intranet address 10.67.0.251 via hosts
//
// How: we do NOT copy or modify the official vpnc-script-win.js. Every branch of
// the official script is driven by PROCESS ENVIRONMENT VARIABLES, and JScript can
// rewrite the current process environment through WScript.Shell's
// Environment("Process"). Child processes started with ws.Run inherit that
// environment, so we can steer the official script precisely without forking it.
//
// Official script lines we rely on (C:\Program Files\OpenConnect\vpnc-script-win.js):
//   :135  switch (env("reason"))            -> pre-init / connect / disconnect
//   :190  if (!env("CISCO_SPLIT_INC") && REDIRECT_GATEWAY_METHOD != 2)
//                                            -> sets tunnel interface metric=1
//                                               (we set CISCO_SPLIT_INC so this is skipped)
//   :199  if (env("CISCO_SPLIT_INC") || REDIRECT_GATEWAY_METHOD > 0)
//                                            -> netsh set address WITHOUT gateway
//                                               => no default route is created
//   :220  netsh delete dnsservers <TUNIDX> all (harmless, should be cleared anyway)
//   :226  if (env("INTERNAL_IP4_DNS"))      -> we blank it => campus DNS not applied
//   :239  if (env("CISCO_SPLIT_INC"))       -> route add <ADDR> mask <MASK> <gw> if <TUNIDX>
//   :154-155 internal_gw = env("INTERNAL_IP4_ADDRESS")
//                                            -> gateway is the tunnel's own address (on-link)
//   :311-313 disconnect deletes the address with gateway=all
//                                            -> interface routes vanish, but static
//                                               routes must be removed by us
//
// NOTE: JScript is ECMAScript 3.0 only. No const / let / trim() / toISOString().
// NOTE: this file MUST stay pure ASCII. cscript reads .js using the system ANSI
//       code page (CP936 here); a UTF-8 Chinese comment would be decoded as GBK
//       and GBK trail bytes can include 0x5C (backslash), which escapes the
//       closing quote and breaks compilation ("Unterminated string constant").
// ============================================================================

var ws = WScript.CreateObject("WScript.Shell");
var env = ws.Environment("Process");
var fso = WScript.CreateObject("Scripting.FileSystemObject");

var OFFICIAL = "C:\\Program Files\\OpenConnect\\vpnc-script-win.js";

// Tongji intranet range (service IPs 10.67.0.251 / 10.67.0.252 live here)
var SPLIT_ADDR = "10.67.0.0";
var SPLIT_MASK = "255.255.0.0";
var SPLIT_MASKLEN = "16";

// The agi public IP is unreachable through the tunnel too (campus network does not
// loop back its own public address; requests time out after ~21s), so it must be
// pinned to the intranet service address.
var TONGJI_HOST = "agi.tongji.edu.cn";
var TONGJI_IP = "10.67.0.251";

var MARK_BEGIN = "# >>> dsh-api-rules tongji-vpn split BEGIN >>>";
var MARK_END = "# <<< dsh-api-rules tongji-vpn split END <<<";

var reason = env("reason") || "";

// ---------------------------------------------------------------------------
// Logging (for troubleshooting, written to %TEMP%\tongji-vpn\split-script.log)
// ---------------------------------------------------------------------------
var logPath = ws.ExpandEnvironmentStrings("%TEMP%") + "\\tongji-vpn\\split-script.log";

function logLine(msg) {
    try {
        var dir = fso.GetParentFolderName(logPath);
        if (!fso.FolderExists(dir)) fso.CreateFolder(dir);
        var f = fso.OpenTextFile(logPath, 8, true, -1); // 8=ForAppending, -1=Unicode
        f.WriteLine("[" + reason + "] " + msg);
        f.Close();
    } catch (e) {
        // logging must never break the tunnel
    }
}

function run(cmd, visible) {
    try {
        return ws.Run(cmd, visible ? 1 : 0, true);
    } catch (e) {
        logLine("run threw: " + cmd + " :: " + e.message);
        return 1;
    }
}

// ---------------------------------------------------------------------------
// hosts managed block (idempotent: the same block is never duplicated)
// ---------------------------------------------------------------------------
var hostsPath = ws.ExpandEnvironmentStrings("%SystemRoot%") + "\\System32\\drivers\\etc\\hosts";
var hostsBackup = hostsPath + ".dsh-tongji.bak";

function readText(path) {
    if (!fso.FileExists(path)) return "";
    var f = fso.OpenTextFile(path, 1, false, 0); // 1=ForReading, 0=ASCII
    var s = f.ReadAll();
    f.Close();
    return s;
}

function writeText(path, text) {
    var f = fso.OpenTextFile(path, 2, true, 0); // 2=ForWriting, 0=ASCII
    f.Write(text);
    f.Close();
}

function stripMarked(text) {
    var lines = text.split("\n");
    var out = [];
    var inside = false;
    for (var i = 0; i < lines.length; i++) {
        var t = lines[i];
        if (t.indexOf(MARK_BEGIN) === 0) { inside = true; continue; }
        if (t.indexOf(MARK_END) === 0) { inside = false; continue; }
        if (inside) continue;
        out.push(t);
    }
    return out.join("\n");
}

function ensureHosts() {
    var text = readText(hostsPath);

    // our managed block already present and correct -> do not touch the file
    if (text.indexOf(MARK_BEGIN) >= 0 &&
        text.indexOf(TONGJI_IP + " " + TONGJI_HOST) >= 0) {
        logLine("hosts: managed block already present and correct, skip");
        return;
    }

    // user already pinned agi by hand and it is not ours -> leave it alone
    if (text.indexOf(MARK_BEGIN) < 0 && text.indexOf(TONGJI_HOST) >= 0) {
        logLine("hosts: unmanaged entry for " + TONGJI_HOST + " exists, skip write");
        return;
    }

    if (!fso.FileExists(hostsBackup)) {
        try {
            fso.CopyFile(hostsPath, hostsBackup, true);
            logLine("hosts: backed up to " + hostsBackup);
        } catch (e) {
            logLine("hosts: backup failed (continuing) :: " + e.message);
        }
    }

    var body = stripMarked(text);
    if (body.length > 0 && body.charAt(body.length - 1) !== "\n") body += "\n";
    body += MARK_BEGIN + "\r\n" +
            TONGJI_IP + " " + TONGJI_HOST + "\r\n" +
            MARK_END + "\r\n";

    try {
        writeText(hostsPath, body);
        logLine("hosts: wrote " + TONGJI_IP + " " + TONGJI_HOST);
    } catch (e) {
        logLine("hosts: write failed :: " + e.message);
    }
}

function removeHosts() {
    var text = readText(hostsPath);
    if (text.indexOf(MARK_BEGIN) < 0) {
        logLine("hosts: no managed block, skip");
        return;
    }
    try {
        writeText(hostsPath, stripMarked(text));
        logLine("hosts: managed block removed");
    } catch (e) {
        logLine("hosts: removal failed :: " + e.message);
    }
}

// Is the 10.67.0.0/16 route actually in the table?
// The official split-include branch uses internal_gw = INTERNAL_IP4_ADDRESS, i.e.
// the tunnel's own address as next hop. That normally resolves as on-link and is
// accepted, but if Windows rejects it the route silently never appears and the
// tunnel would come up while 10.67.0.251 stays unreachable. So we verify.
function splitRoutePresent() {
    try {
        var exec = ws.Exec("cmd /c route print");
        var out = exec.StdOut.ReadAll();
        var lines = out.split("\n");
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf(SPLIT_ADDR) >= 0 &&
                lines[i].indexOf(SPLIT_MASK) >= 0) {
                return true;
            }
        }
        return false;
    } catch (e) {
        // cannot tell -- do not add a possibly duplicate route
        logLine("route check failed :: " + e.message);
        return true;
    }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
logLine("enter TUNIDX=" + env("TUNIDX") +
        " DEV=" + env("TUNDEV") +
        " IP4=" + env("INTERNAL_IP4_ADDRESS") +
        " MASK=" + env("INTERNAL_IP4_NETMASK") +
        " DNS4=" + env("INTERNAL_IP4_DNS") +
        " IP6=" + env("INTERNAL_IP6_ADDRESS") +
        " SPLIT=" + env("CISCO_SPLIT_INC") +
        " VPNGW=" + env("VPNGATEWAY"));

if (reason === "connect") {
    // key: enable the official script's split-include branch
    env("CISCO_SPLIT_INC") = "1";
    env("CISCO_SPLIT_INC_0_ADDR") = SPLIT_ADDR;
    env("CISCO_SPLIT_INC_0_MASK") = SPLIT_MASK;
    env("CISCO_SPLIT_INC_0_MASKLEN") = SPLIT_MASKLEN;
    // key: blank DNS so the official :226 test is false => system DNS untouched
    env("INTERNAL_IP4_DNS") = "";
    env("INTERNAL_IP6_DNS") = "";
} else if (reason === "disconnect") {
    // let the official disconnect branch run normally (it deletes the address)
    env("CISCO_SPLIT_INC") = "1";
    env("CISCO_SPLIT_INC_0_ADDR") = SPLIT_ADDR;
    env("CISCO_SPLIT_INC_0_MASK") = SPLIT_MASK;
    env("CISCO_SPLIT_INC_0_MASKLEN") = SPLIT_MASKLEN;
    env("INTERNAL_IP4_DNS") = "";
    env("INTERNAL_IP6_DNS") = "";

    // remove hosts and the split route first, while the adapter still exists
    removeHosts();
    var rcRoute = run("route delete " + SPLIT_ADDR + " mask " + SPLIT_MASK, false);
    logLine("route delete " + SPLIT_ADDR + "/" + SPLIT_MASKLEN + " rc=" + rcRoute);
}

if (!fso.FileExists(OFFICIAL)) {
    logLine("FATAL: official script not found at " + OFFICIAL);
    WScript.Quit(1);
}

// reason is inherited by the child process; invoke the official script
var rc = run('cscript //nologo "' + OFFICIAL + '"', false);
logLine("official script rc=" + rc);

if (reason === "connect") {
    // write hosts after the official script so the adapter is already up, and so a
    // hosts failure can never break the tunnel itself
    ensureHosts();

    // fallback: if the official split route did not land, add it on-link ourselves
    if (!splitRoutePresent()) {
        var fb = run("route add " + SPLIT_ADDR + " mask " + SPLIT_MASK +
                     " 0.0.0.0 if " + env("TUNIDX") + " metric 1", false);
        logLine("FALLBACK route add on-link rc=" + fb);
    } else {
        logLine("split route present");
    }
}

WScript.Quit(rc);
