@echo off
REM Default is safe loopback-only mode. LAN requires explicit --lan and a fixed port:
REM BookieFiscalService.exe --lan --host 0.0.0.0 --port 17831
BookieFiscalService.exe --host 127.0.0.1 --port 17831