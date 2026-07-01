@echo off
REM Aura Music Player launcher v1.9.0
REM https://github.com/dingyi222666/aura-music
REM 一键启动: Vite Web + Lyric Overlay WS server + Desktop Lyrics 窗口

setlocal enabledelayedexpansion
set "PROJECT_VERSION=1.9.0"
set "TARGET_PORT=3000"
set "WS_PORT=8787"
set "SCRIPT_DIR=%~dp0"
set "PROJECT=%SCRIPT_DIR%aura-music-%PROJECT_VERSION%"
set "WS_SERVER_DIR=%PROJECT%\lyric-overlay-server"
set "DESKTOP_LYRICS_EXE=%PROJECT%\desktop-lyrics\src-tauri\target\release\aura-desktop-lyrics.exe"

title Aura Music Player v%PROJECT_VERSION%

REM ============== 1. 定位项目目录 ==============
if not exist "%PROJECT%" (
    echo [错误] 找不到项目目录: %PROJECT%
    echo 请确认 aura-music-%PROJECT_VERSION% 文件夹与该脚本在同一目录下。
    pause
    exit /b 1
)
cd /d "%PROJECT%"
echo [1/7] 项目目录: %PROJECT%

REM ============== 2. 定位 Node.js ==============
set "NODE_EXE="

for /f "delims=" %%i in ('where node.exe 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%i"
)

if not defined NODE_EXE (
    for %%P in (
        "%ProgramFiles%\nodejs\node.exe"
        "%ProgramFiles(x86)%\nodejs\node.exe"
        "%LOCALAPPDATA%\Programs\nodejs\node.exe"
        "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe"
        "%USERPROFILE%\.workbuddy\binaries\node\versions\24.16.0\node.exe"
        "D:\7\DeepChat\resources\app.asar.unpacked\runtime\node\node.exe"
    ) do (
        if not defined NODE_EXE if exist %%P set "NODE_EXE=%%~P"
    )
)

if not defined NODE_EXE (
    echo [错误] 未找到 Node.js。请从 https://nodejs.org 安装 LTS 版本。
    pause
    exit /b 1
)

for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
set "NODE_DIR=%NODE_DIR:~0,-1%"
set "PATH=%NODE_DIR%;%PATH%"

for /f "delims=" %%v in ('"%NODE_EXE%" --version') do set "NODE_VER=%%v"
echo [2/7] Node.js: %NODE_VER%  ^(%NODE_EXE%^)

REM ============== 3. 检查端口占用(3000 + 8787)=============
set "NPM_CMD=%NODE_DIR%\npm.cmd"
if not exist "%NPM_CMD%" set "NPM_CMD=npm"

set "PORT_BUSY=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%TARGET_PORT% " ^| findstr "LISTENING"') do (
    set "PORT_BUSY=1"
    set "OCCUPANT_PID=%%a"
)

if "%PORT_BUSY%"=="1" (
    echo [警告] 端口 %TARGET_PORT% 已被占用 ^(PID %OCCUPANT_PID%^)
    set /p "choice=是否终止该进程并继续? (y/N): "
    if /i "!choice!"=="y" (
        taskkill /F /PID !OCCUPANT_PID! >nul 2>&1
        if !errorlevel! neq 0 (
            echo [错误] 无法终止进程，请手动关闭后重试。
            pause
            exit /b 1
        )
        echo   已终止 PID !OCCUPANT_PID!
        timeout /t 1 /nobreak >nul
    ) else (
        echo 已取消启动。请手动关闭占用端口的程序后重试。
        pause
        exit /b 0
    )
)

set "WS_BUSY=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%WS_PORT% " ^| findstr "LISTENING"') do (
    set "WS_BUSY=1"
    set "WS_PID=%%a"
)
if "%WS_BUSY%"=="1" (
    echo [警告] 端口 %WS_PORT% ^(WS^) 已被占用 ^(PID %WS_PID%^)，可能是上次未正常关闭
    taskkill /F /PID !WS_PID! >nul 2>&1
    timeout /t 1 /nobreak >nul
)

echo [3/7] 端口 %TARGET_PORT% / %WS_PORT% 可用

REM ============== 4. 安装 Web 项目依赖 ==============
if not exist "node_modules" (
    echo [4/7] 首次运行，安装 Web 项目依赖 ^(--no-fund --no-audit^)...
    call "!NPM_CMD!" install --no-fund --no-audit
    if !errorlevel! neq 0 (
        echo.
        echo [错误] npm install 失败 ^(退出码 !errorlevel!^)
        echo 常见原因:
        echo   - 网络问题: 切换镜像 -^> npm config set registry https://registry.npmmirror.com
        echo   - 权限问题: 以管理员身份运行此脚本
        echo   - Node 版本过低: 需要 Node 18+，当前 %NODE_VER%
        pause
        exit /b 1
    )
    echo   Web 依赖安装完成
) else (
    echo [4/7] Web 项目依赖已存在，跳过安装
)

REM ============== 5. 安装 WS server 依赖 ==============
if not exist "%WS_SERVER_DIR%\node_modules" (
    echo [5/7] 安装 Lyric Overlay WS server 依赖...
    pushd "%WS_SERVER_DIR%"
    call "!NPM_CMD!" install --no-fund --no-audit
    set "WS_INSTALL_RC=!errorlevel!"
    popd
    if !WS_INSTALL_RC! neq 0 (
        echo [警告] WS server 依赖安装失败，桌面歌词功能将不可用
        echo        Web 播放器仍可正常使用
    ) else (
        echo   WS server 依赖安装完成
    )
) else (
    echo [5/7] WS server 依赖已存在，跳过安装
)

REM ============== 6. 检查桌面歌词窗口可执行文件 ==============
set "DESKTOP_LYRICS_OK=0"
if exist "%DESKTOP_LYRICS_EXE%" (
    set "DESKTOP_LYRICS_OK=1"
    echo [6/7] 桌面歌词窗口已就绪: aura-desktop-lyrics.exe
    echo        启动后在 aura-music 顶栏点击"桌面歌词"按钮开启
) else (
    echo [6/7] 未找到桌面歌词 exe ^(路径: %DESKTOP_LYRICS_EXE%^)
    echo        如需编译桌面窗口，请参考 desktop-lyrics\README.md
)

REM ============== 7. 启动全部组件 ==============
set "VITE_BIN=%PROJECT%\node_modules\vite\bin\vite.js"
if not exist "%VITE_BIN%" (
    echo [错误] vite 未安装，请删除 node_modules 后重试
    pause
    exit /b 1
)

echo [7/7] 启动 Aura Music Player + Lyric Overlay WS...
echo.
echo ================================================
echo   Aura Music v%PROJECT_VERSION%
echo   Web 播放器:    http://localhost:%TARGET_PORT%
echo   WS 桌面歌词:   ws://127.0.0.1:%WS_PORT%
echo   桌面歌词窗口: 在 Web 播放器顶栏点击图标开启
echo   按 Ctrl+C 停止全部服务
echo ================================================
echo.

REM 后台启动 WS server
if exist "%WS_SERVER_DIR%\server.js" if exist "%WS_SERVER_DIR%\node_modules" (
    start "Aura Lyric WS" /min "%NODE_EXE%" "%WS_SERVER_DIR%\server.js"
    echo   已启动 Lyric Overlay WS server ^(后台最小化^)
)

REM 桌面歌词窗口不再自动启动，由 aura-music 顶栏开关控制

REM 延迟 2 秒后打开浏览器(异步)
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%TARGET_PORT%"

REM 前台运行 Vite,Ctrl+C 退出
"%NODE_EXE%" "%VITE_BIN%" --host 127.0.0.1 --port %TARGET_PORT%

REM Vite 退出后清理 WS server 和桌面歌词窗口(如果在跑)
echo.
echo 正在停止 Lyric Overlay WS server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%WS_PORT% " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo 正在停止 Desktop Lyrics 窗口...
taskkill /F /IM "aura-desktop-lyrics.exe" >nul 2>&1

echo.
echo 服务已全部停止。
pause
endlocal
