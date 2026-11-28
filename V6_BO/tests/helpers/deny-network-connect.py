"""Linux acceptance harness: deny outbound connections in the exec'd process tree.

An external test client can still connect to the fixture's local HTTP listener.
No filter is installed on the user's shell or on the production service.
"""
import ctypes
import errno
import os
import socket
import sys


def deny_outbound():
    lib = ctypes.CDLL("libseccomp.so.2")
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    ctx = lib.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not ctx:
        raise RuntimeError("seccomp_init failed")
    try:
        deny = 0x00050000 | errno.ENETUNREACH
        # Block new connections and connectionless sends (including DNS).
        # libuv's accepted TCP sockets write responses via write/writev.
        for name in (b"connect", b"sendto", b"sendmsg", b"sendmmsg", b"io_uring_setup"):
            nr = lib.seccomp_syscall_resolve_name(name)
            if nr < 0 or lib.seccomp_rule_add(ctx, deny, nr, 0) != 0:
                raise RuntimeError("could not deny " + name.decode())
        if lib.seccomp_load(ctx) != 0:
            raise RuntimeError("kernel rejected network filter")
    finally:
        lib.seccomp_release(ctx)
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 1)) != errno.ENETUNREACH:
            raise RuntimeError("outbound negative control failed")


if __name__ == "__main__":
    deny_outbound()
    os.execvp(sys.argv[1], sys.argv[1:])
