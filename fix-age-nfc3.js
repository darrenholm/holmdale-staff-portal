const fs = require("fs");
let content = fs.readFileSync("public/age-verification.html", "utf8");

const oldCode = `        async function approveWristband(uid) {
            const uid = this.value.trim();
            if (!uid) return;
            console.log('Approving wristband:', uid);
            try {
                // Approve the wristband
                const r = await fetch(API + '/wristbands/approve-age', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ rfid_uid: uid })
                });
                const d = await r.json();
                if (r.ok) {
                    const band = d.wristband;
                    // Show success
                    showApproved(band);
                    approvedCount++;
                    updateCount();
                    // Clear and refocus after 3 seconds
                    setTimeout(reset, 3000);
                } else {
                    showMessage('‚å ' + d.error, 'error');
                    this.value = '';
                    this.focus();
                }
            } catch(err) {
                console.error('Approval error:', err);
                showMessage('‚å Error approving wristband', 'error');
                this.value = '';
                this.focus();
            }
        });`;

const newCode = `        async function approveWristband(uid) {
            if (!uid) return;
            console.log('Approving wristband:', uid);
            try {
                const r = await fetch(API + '/wristbands/approve-age', {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ rfid_uid: uid })
                });
                const d = await r.json();
                if (r.ok) {
                    const band = d.wristband;
                    showApproved(band);
                    approvedCount++;
                    updateCount();
                    setTimeout(reset, 3000);
                } else {
                    showMessage('? ' + d.error, 'error');
                    document.getElementById('wristbandId').value = '';
                    document.getElementById('wristbandId').focus();
                }
            } catch(err) {
                console.error('Approval error:', err);
                showMessage('? Error approving wristband', 'error');
                document.getElementById('wristbandId').value = '';
                document.getElementById('wristbandId').focus();
            }
        }`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync("public/age-verification.html", content, "utf8");
    console.log("Fixed!");
} else {
    console.log("Exact match not found");
}
