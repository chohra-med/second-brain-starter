"""Bounded, no-follow reads shared by index, the readiness check, finalize-init and doctor.

Standard library only. Every reader refuses symbolic links, FIFOs, devices and other non-regular
files, refuses files over a byte budget, and notices a file that changes while it is read. With a
``root``, the path is relative to that root and every directory on the way is opened without
following links, so a symlinked parent (for example a symlinked ``.claude/``) is refused too.

Errors are ``SafeReadError`` (a ``ValueError``). Callers report them as PENDING; nothing here prints.
Callers run under ``python3 -I -B`` and import this module through an explicit path to ``bin/``.
"""
import errno
import json
import os
import stat

MAX_RECEIPT_BYTES = 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_JOURNAL_BYTES = 64 * 1024 * 1024
MAX_STATE_BYTES = 256 * 1024
MAX_RECEIPT_OUTPUTS = 4096
MAX_RECEIPT_OUTPUT_BYTES = 8 * 1024 * 1024

# Reasons keep the wording the index already records in its inventory, so the inventory bytes
# do not change when the index reads through this module.
NOT_REGULAR = "not a regular in-root file"
# O_NOFOLLOW on a final link gives ELOOP (EMLINK on some BSDs); a link or file used as a directory
# gives ENOTDIR.
_LINK_ERRNOS = {errno.ELOOP, errno.EMLINK, errno.ENOTDIR}
CHANGED = "file changed during inventory"


class SafeReadError(ValueError):
    """A read was refused. ``reason`` is the short cause; ``str()`` names the path too."""

    def __init__(self, display, reason):
        self.display = display
        self.reason = reason
        super().__init__(f"{display}: {reason}")


def safe_relative(value):
    """A normalized, in-root, relative POSIX path with no empty, '.' or '..' component."""
    return (
        isinstance(value, str)
        and bool(value)
        and len(value) <= 4096
        and not value.startswith("/")
        and "\\" not in value
        and "\x00" not in value
        and all(part not in {"", ".", ".."} for part in value.split("/"))
    )


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


def _read_fd(fd, limit):
    chunks = []
    remaining = limit + 1
    while remaining:
        chunk = os.read(fd, min(remaining, 64 * 1024))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_bounded(path, max_bytes, *, root=None, allow_symlink=False):
    """Return the bytes of one regular file of at most ``max_bytes`` bytes.

    ``path`` is relative to ``root`` when ``root`` is given (every component is opened without
    following links), otherwise any path whose final component must not be a link unless
    ``allow_symlink`` is set. Raises SafeReadError.
    """
    display = str(path)
    descriptors = []
    parents = []
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | nofollow
    try:
        if root is not None:
            if not safe_relative(path):
                raise SafeReadError(display, "unsafe or non-normalized relative path")
            current = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            descriptors.append(current)
            parts = path.split("/")
            for component in parts[:-1]:
                before = os.stat(component, dir_fd=current, follow_symlinks=False)
                if not stat.S_ISDIR(before.st_mode):
                    raise SafeReadError(display, NOT_REGULAR)
                child = os.open(component, directory_flags, dir_fd=current)
                descriptors.append(child)
                parents.append((current, component, os.fstat(child)))
                current = child
            name, dir_fd = parts[-1], current
            initial = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
        else:
            name, dir_fd = os.fspath(path), None
            initial = os.lstat(name)
            if stat.S_ISLNK(initial.st_mode) and allow_symlink:
                initial = os.stat(name)
        if not stat.S_ISREG(initial.st_mode):
            raise SafeReadError(display, NOT_REGULAR)
        if initial.st_size > max_bytes:
            raise SafeReadError(display, f"exceeds {max_bytes}-byte read limit")
        flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0)
        if root is not None or not allow_symlink:
            flags |= nofollow
        fd = os.open(name, flags, dir_fd=dir_fd) if dir_fd is not None else os.open(name, flags)
        descriptors.append(fd)
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or _identity(opened) != _identity(initial):
            raise SafeReadError(display, CHANGED)
        data = _read_fd(fd, max_bytes)
        if len(data) > max_bytes:
            raise SafeReadError(display, f"exceeds {max_bytes}-byte read limit")
        final = os.stat(name, dir_fd=dir_fd, follow_symlinks=False) if dir_fd is not None else os.stat(name, follow_symlinks=allow_symlink)
        if _identity(os.fstat(fd)) != _identity(opened) or _identity(final) != _identity(opened) or len(data) != opened.st_size:
            raise SafeReadError(display, CHANGED)
        for parent, component, before in parents:
            after = os.stat(component, dir_fd=parent, follow_symlinks=False)
            if not stat.S_ISDIR(after.st_mode) or (after.st_dev, after.st_ino) != (before.st_dev, before.st_ino):
                raise SafeReadError(display, "directory changed during read")
        return data
    except SafeReadError:
        raise
    except FileNotFoundError:
        raise SafeReadError(display, "missing") from None
    except (OSError, ValueError) as error:
        reason = NOT_REGULAR if isinstance(error, OSError) and error.errno in _LINK_ERRNOS else f"unreadable ({error.__class__.__name__})"
        raise SafeReadError(display, reason) from None
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def read_bounded_result(path, max_bytes, *, root=None, allow_symlink=False):
    """The same read as ``read_bounded``, returned as ``(data, None)`` or ``(None, reason)``."""
    try:
        return read_bounded(path, max_bytes, root=root, allow_symlink=allow_symlink), None
    except SafeReadError as error:
        return None, error.reason


def load_json_object(path, max_bytes, *, root=None, what="JSON file"):
    """Read through ``read_bounded`` and parse one JSON object. Raises SafeReadError."""
    data = read_bounded(path, max_bytes, root=root)
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise SafeReadError(str(path), f"invalid JSON {what}") from None
    if not isinstance(value, dict):
        raise SafeReadError(str(path), f"{what} must be a JSON object")
    return value


class WriteRefused(Exception):
    """A write was refused: an unsafe path, a link or non-directory on the way, or a non-regular target."""


def write_regular(root, rel, data, executable=False):
    """Create or atomically replace one file under ``root`` without following a link on the way.

    Every directory component is opened with ``O_NOFOLLOW``, the temporary file is created exclusively
    without following links, and the final name is only replaced when it is a regular file or absent.
    Raises WriteRefused.
    """
    if not safe_relative(rel):
        raise WriteRefused(f"unsafe write path: {rel!r}")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptors = [os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))]
    temporary = None
    try:
        for part in rel.split("/")[:-1]:
            try:
                os.mkdir(part, 0o755, dir_fd=descriptors[-1])
            except FileExistsError:
                pass
            try:
                descriptors.append(os.open(part, flags, dir_fd=descriptors[-1]))
            except OSError:
                raise WriteRefused(f"refusing a link or non-directory on the way to {rel}") from None
        name = rel.split("/")[-1]
        directory = descriptors[-1]
        try:
            info = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode):
                raise WriteRefused(f"refusing to replace a non-regular file: {rel}")
        except FileNotFoundError:
            pass
        temporary = f".spec-harness-update-{os.getpid()}-{os.urandom(6).hex()}"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                     0o755 if executable else 0o644, dir_fd=directory)
        try:
            view = memoryview(data)
            while view:
                view = view[os.write(fd, view):]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        temporary = None
        os.fsync(directory)
    finally:
        if temporary:
            try:
                os.unlink(temporary, dir_fd=descriptors[-1])
            except FileNotFoundError:
                pass
        for fd in reversed(descriptors):
            os.close(fd)
