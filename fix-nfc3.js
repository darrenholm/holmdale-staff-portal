const fs = require("fs");
let content = fs.readFileSync("public/entry-scanner.html", "utf8");

const oldCode = `function listenForWristbands() {
            if ('NDEFReader' in window) {
                const ndef = new NDEFReader();
                ndef.scan().then(() => {
                    console.log("NFC scan started");
                    document.getElementById('nfcStatus').textContent = 'Ready - Tap wristband';
                    ndef.onreading = async (event) => {
                        if (!wristbandInputActive) return;
                        const uid = event.serialNumber.replace(/:/g, '').toUpperCase();
                        console.log("NFC tag read:", uid);
                        await assignBand(uid);
                    };
                    ndef.onreadingerror = () => {
                        console.log("NFC read error - try again");
                    };
                }).catch(err => {
                    console.error("NFC error:", err);
                    document.getElementById('nfcStatus').textContent = 'NFC not available - enter UID manually';
                    showManualInput();
                });
            } else {
                console.log("Web NFC not supported");
                document.getElementById('nfcStatus').textContent = 'NFC not supported - enter UID manually';
                showManualInput();
            }
        }`;

const newCode = `function listenForWristbands() {
            showManualInput();
            if ('NDEFReader' in window) {
                document.getElementById('nfcStatus').textContent = 'Tap the button below to enable NFC';
                let nfcBtn = document.createElement('button');
                nfcBtn.id = 'nfcStartBtn';
                nfcBtn.innerHTML = '?? Tap Here to Enable NFC Scanning';
                nfcBtn.style.cssText = 'width:100%;padding:20px;font-size:18px;font-weight:bold;background:#00B74A;color:white;border:none;border-radius:15px;margin-top:15px;cursor:pointer;';
                document.getElementById('assignmentScreen').insertBefore(nfcBtn, document.getElementById('manualWristband'));
                nfcBtn.addEventListener('click', async function() {
                    try {
                        const ndef = new NDEFReader();
                        await ndef.scan();
                        nfcBtn.innerHTML = '? NFC Active - Tap Wristband Now';
                        nfcBtn.style.background = '#2d7a4f';
                        document.getElementById('nfcStatus').textContent = 'NFC ready - tap wristband to phone';
                        ndef.onreading = async (event) => {
                            if (!wristbandInputActive) return;
                            const uid = event.serialNumber.replace(/:/g, '').toUpperCase();
                            console.log("NFC tag read:", uid);
                            await assignBand(uid);
                        };
                        ndef.onreadingerror = () => {
                            console.log("NFC read error");
                            document.getElementById('nfcStatus').textContent = 'Read error - try again';
                        };
                    } catch(err) {
                        console.error("NFC error:", err);
                        nfcBtn.innerHTML = '? NFC Failed: ' + err.message;
                        nfcBtn.style.background = '#e53e3e';
                        document.getElementById('nfcStatus').textContent = 'Use manual input below';
                    }
                });
            } else {
                document.getElementById('nfcStatus').textContent = 'NFC not supported on this browser - use manual input';
            }
        }`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync("public/entry-scanner.html", content, "utf8");
    console.log("Fixed!");
} else {
    console.log("Exact match not found - checking...");
    console.log("Has NDEFReader:", content.includes("NDEFReader"));
    console.log("Has listenForWristbands:", content.includes("function listenForWristbands"));
}
