"""Streamlit entrypoint for the Rosen Academy ICP-OES laboratory."""
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

from streamlit_runtime import SimulatorRuntime

ROOT = Path(__file__).resolve().parent
st.set_page_config(
    page_title="Rosen Academy · ICP-OES Calibration Lab",
    page_icon="🧪", layout="wide", initial_sidebar_state="collapsed",
)
st.markdown(
    """<style>
    .stMainBlockContainer {padding:0 !important; max-width:none !important;}
    .stMainBlockContainer > div {gap:0 !important;}
    header[data-testid="stHeader"] {background:transparent; height:0;}
    [data-testid="stAppViewContainer"] {background:#fff;}
    iframe {display:block; border:0;}
    </style>""", unsafe_allow_html=True,
)


@st.cache_resource
def runtime() -> SimulatorRuntime:
    return SimulatorRuntime(ROOT)


snapshot = runtime().refresh()
st.session_state["displayed_release"] = snapshot.signature
if snapshot.error:
    if snapshot.release:
        st.warning("The latest update is not available yet. The previous working version is shown.")
    else:
        st.error("The simulator could not be loaded. The deployment needs a fresh application build.")
if snapshot.release:
    # This iframe stays outside the polling fragment. Ordinary update checks
    # must never interrupt acquisition or reset a student's current session.
    components.html(snapshot.release.html, height=1900, scrolling=True)


@st.fragment(run_every=2)
def watch_updates() -> None:
    updated = runtime().refresh()
    if updated.signature != st.session_state.get("displayed_release"):
        st.rerun()


watch_updates()
