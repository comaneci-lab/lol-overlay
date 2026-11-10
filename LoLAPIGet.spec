# -*- mode: python ; coding: utf-8 -*-

import os

GUI_IMAGES = (
    'dragon_chemtech.png',
    'dragon_cloud.png',
    'dragon_elder.png',
    'dragon_hextech.png',
    'dragon_infernal.png',
    'dragon_mountain.png',
    'dragon_ocean.png',
    'icon_baron.png',
    'icon_dragon.png',
    'icon_herald.png',
    'icon_voidclub.png',
)


a = Analysis(
    ['LoLProxy.py'],
    pathex=[],
    binaries=[],
    datas=[
        (os.path.join(SPECPATH, 'assets', image), 'assets')
        for image in GUI_IMAGES
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='LoLAPIGet',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
