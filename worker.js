// worker.js - Deploy this to Cloudflare
// Requirements: Enable Durable Objects and bind 'SIGNALING' to the class 'SignalingServer'

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Route websocket requests to the Durable Object
    if (url.pathname === "/ws") {
      const id = env.SIGNALING.idFromName("global-room"); // Single global room for simplicity
      const stub = env.SIGNALING.get(id);
      return stub.fetch(request);
    }
    
    return new Response("Ghost_Link Signaling Server Online", { status: 200 });
  }
};

// The Durable Object Class
export class SignalingServer {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map(); // Map<UserId, WebSocket>
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    
    await this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSession(webSocket) {
    webSocket.accept();
    let userId = null;

    webSocket.addEventListener("message", async (msg) => {
      try {
        const data = JSON.parse(msg.data);

        // 1. User registers their ID
        if (data.type === 'REGISTER') {
          userId = data.id;
          this.sessions.set(userId, webSocket);
          console.log(`User registered: ${userId}`);
        } 
        
        // 2. User sends a signal (Offer, Answer, ICE) to a specific target
        else if (data.target && this.sessions.has(data.target)) {
          const targetSocket = this.sessions.get(data.target);
          if (targetSocket.readyState === WebSocket.READY) {
            // Forward the message to the target
            targetSocket.send(JSON.stringify({
              type: data.type,
              sender: userId, // Stamp the sender ID
              payload: data.payload
            }));
          }
        }
      } catch (err) {
        console.error("Error parsing message", err);
      }
    });

    webSocket.addEventListener("close", () => {
      if (userId) {
        this.sessions.delete(userId);
      }
    });
  }
}
