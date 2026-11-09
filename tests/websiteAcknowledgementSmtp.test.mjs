import net from "node:net";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const port = 25268;
const received = [];
const server = net.createServer(socket => {
  let buffer = "", inData = false, message = "";
  socket.write("220 localhost V79 isolated SMTP test\r\n");
  socket.on("data", chunk => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\r\n")) {
      const idx=buffer.indexOf("\r\n");
      const line=buffer.slice(0,idx);
      buffer=buffer.slice(idx+2);
      if (inData) {
        if (line === ".") {
          received.push(message);
          inData=false; message="";
          socket.write("250 2.0.0 Queued in isolated test\r\n");
        } else message += line+"\r\n";
      } else if (/^(EHLO|HELO)/i.test(line)) {
        socket.write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1000000\r\n");
      } else if (/^AUTH PLAIN/i.test(line)) socket.write("235 2.7.0 Authentication successful\r\n");
      else if (/^AUTH LOGIN/i.test(line)) socket.write("334 VXNlcm5hbWU6\r\n");
      else if (/^MAIL FROM|^RCPT TO|^RSET/i.test(line)) socket.write("250 2.1.0 Accepted\r\n");
      else if (/^DATA/i.test(line)) {inData=true;socket.write("354 End with <CRLF>.<CRLF>\r\n");}
      else if (/^QUIT/i.test(line)) {socket.write("221 Goodbye\r\n");socket.end();}
      else if (/^NOOP/i.test(line)) socket.write("250 OK\r\n");
      else socket.write("235 2.7.0 Authentication successful\r\n");
    }
  });
});

try {
  await new Promise(resolve => server.listen(port,"127.0.0.1",resolve));
  process.env.SMTP_HOST="127.0.0.1";
  process.env.SMTP_PORT=String(port);
  process.env.SMTP_USER="local-only-user";
  process.env.SMTP_PASS="local-only-password";
  process.env.SMTP_FROM="Vision79 Test <test@example.invalid>";
  process.env.APP_BASE_URL="https://tiquet.v79sl.com";
  const {sendWebsiteTicketAcknowledgement} = await import("../server/email.js");
  const portalToken=crypto.randomBytes(32).toString("base64url");
  assert.equal(portalToken.length,43);
  const result=await sendWebsiteTicketAcknowledgement({
    to:"workflow.test@example.invalid",
    customerName:"Test Contact",title:"Network equipment installation",
    requestSummary:"Confirm ethernet and Wi-Fi installation",
    reference:"TQ-F51AB2461234",portalToken
  });
  assert.equal(result.success,true,JSON.stringify(result));
  assert.equal(result.skipped,undefined);
  assert.equal(received.length,1);
  assert.match(received[0],/TQ-F51AB2461234/);
  // Quoted-printable SMTP messages may fold long hrefs across soft breaks.
  const unfolded = received[0].split(String.fromCharCode(61, 13, 10)).join("");
  assert.match(unfolded,/https:\/\/tiquet.v79sl.com\/portal\//);
  assert.match(unfolded,/network equipment installation/i);
  console.log("ISOLATED_SMTP_WELCOME_EMAIL_ACCEPTED_PASS");
} finally {
  await new Promise(resolve=>server.close(resolve));
}
