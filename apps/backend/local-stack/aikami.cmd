@echo off
REM apps/backend/local-stack/aikami.cmd
REM
REM Shim so `aikami ...` works from cmd.exe, PowerShell, and Windows Terminal
REM alike: PATHEXT does not include .ps1, so a bare `aikami` only resolves when
REM there is a .cmd next to the script. -ExecutionPolicy Bypass keeps the
REM default RemoteSigned policy from blocking a script we just installed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0aikami.ps1" %*
