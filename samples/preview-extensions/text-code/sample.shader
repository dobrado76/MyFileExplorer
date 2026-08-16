Shader "Sample/Unlit" {
  SubShader {
    Pass {
      CGPROGRAM
      #pragma vertex vert
      float4 vert() : SV_POSITION { return 0; }
      ENDCG
    }
  }
}
