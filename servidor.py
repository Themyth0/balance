import os
import sys
import webbrowser
import http.server
import socketserver
from threading import Timer

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Desactivar caché local para desarrollo y actualizaciones fluidas
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def open_browser():
    url = f"http://localhost:{PORT}"
    print(f"[*] Abriendo la aplicacion en tu navegador: {url}")
    webbrowser.open(url)

if __name__ == '__main__':
    # Permitir reutilizar la dirección rápidamente si se reinicia
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
            print("=" * 65)
            print("   ⚖️ BALANCE & PRECIOS - GESTOR DE IMPORTACIÓN (RMB ⇄ EUR)")
            print("=" * 65)
            print(f"[*] Servidor local activo en: http://localhost:{PORT}")
            print("[*] Pulsa Ctrl + C en esta ventana para cerrar el servidor.")
            print("=" * 65)
            
            # Abrir navegador tras 1 segundo
            Timer(1.0, open_browser).start()
            
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Servidor detenido por el usuario. ¡Hasta pronto!")
        sys.exit(0)
    except OSError as e:
        if e.errno == 10048 or "Address already in use" in str(e):
            print(f"[!] El puerto {PORT} ya esta en uso. Abriendo http://localhost:{PORT} directamente...")
            webbrowser.open(f"http://localhost:{PORT}")
        else:
            print(f"[!] Error al iniciar el servidor: {e}")
